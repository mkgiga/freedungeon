import { z } from 'zod'
import { router, procedure } from '../../trpc'
import { mutate, state } from '../../server'
import { unwrap } from 'solid-js/store'
import { nanoid } from 'nanoid'
import type { ImageAsset } from '@shared/types'
import { flipUpload } from '../uploads'

export const imagesRouter = router({
    list: procedure
        .query(() => Object.values(state.assets.images)),

    create: procedure
        .input(z.object({
            key: z.string().regex(/^[a-z][a-z0-9_]*$/, 'Use snake_case (lowercase + underscores).'),
            label: z.string().min(1),
            url: z.string().min(1),
        }))
        .mutation(({ input }) => {
            const clash = Object.values(state.assets.images).find(i => i.key === input.key)
            if (clash) throw new Error(`An image with key "${input.key}" already exists`)

            const now = Date.now()
            const image: ImageAsset = {
                id: nanoid(),
                key: input.key,
                label: input.label,
                url: input.url,
                createdAt: now,
                updatedAt: now,
            }
            mutate(s => { s.assets.images[image.id] = image })
            return image
        }),

    update: procedure
        .input(z.object({
            id: z.string(),
            key: z.string().regex(/^[a-z][a-z0-9_]*$/, 'Use snake_case (lowercase + underscores).').optional(),
            label: z.string().min(1).optional(),
        }))
        .mutation(({ input }) => {
            const existing = state.assets.images[input.id]
            if (!existing) throw new Error('Image not found')
            if (input.key && input.key !== existing.key) {
                const clash = Object.values(state.assets.images).find(i => i.key === input.key)
                if (clash) throw new Error(`An image with key "${input.key}" already exists`)
            }

            mutate(s => { s.assets.images[input.id] = {
                ...existing,
                ...(input.key ? { key: input.key } : {}),
                ...(input.label ? { label: input.label } : {}),
                updatedAt: Date.now(),
            } })
            return { success: true }
        }),

    /**
     * Mirrors an image and repoints everything that referenced it.
     *
     * The rewrite is the point. A flip produces a new URL, so without it the
     * image would only look flipped wherever the caller happened to update and
     * every other surface would keep showing the original — one character
     * facing two directions depending on the screen.
     *
     * Uploads are content-addressed, so one file backs every use of identical
     * bytes: flipping an image two actors share flips it for both. That is the
     * intended reading — the operation applies to the image, not to one slot.
     */
    flip: procedure
        .input(z.object({ url: z.string().min(1) }))
        .mutation(async ({ input }) => {
            const next = await flipUpload(input.url)
            if (!next) throw new Error('That image cannot be flipped')
            if (next !== input.url) retargetUrl(input.url, next)
            return { url: next }
        }),

    delete: procedure
        .input(z.object({ id: z.string() }))
        .mutation(({ input }) => {
            mutate(s => { delete s.assets.images[input.id] })

            for (const chat of Object.values(state.assets.chats)) {
                if (!chat.assets.images?.includes(input.id)) continue
                mutate(s => { s.assets.chats[chat.id]!.assets.images = chat.assets.images.filter(id => id !== input.id) })
            }
            if (state.currentChat.id && state.currentChat.assets.images?.includes(input.id)) {
                mutate(s => { s.currentChat.assets.images = state.currentChat.assets.images.filter(id => id !== input.id) })
            }
            return { success: true }
        }),

})

/**
 * Repoints every stored reference to an image, by walking the store rather
 * than by naming the fields that hold URLs.
 *
 * Naming them is the obvious implementation and it rots: the next field that
 * holds an upload URL — on a Note, on some future entity — gets added by
 * someone who has no reason to know this function exists, and from then on
 * flipping that image leaves it stale. Nothing fails loudly; the row just
 * quietly disagrees with the rest of the database. A walk cannot forget a
 * field it was never told about, so new fields are covered the day they land.
 *
 * Done in two passes, and the split is what keeps it cheap. Searching inside
 * `mutate` would drag every object the search touches through an Immer proxy —
 * measured at 32ms across a store with 10k messages, to produce no patches at
 * all in the common case. So the search runs first against the unwrapped
 * state, which is a plain object graph and costs ~1ms, and `mutate` is then
 * handed only the paths that actually matched.
 *
 * Matching is whole-value equality, never substring. A field either *is* a
 * reference to this image or it is not; rewriting inside longer strings would
 * mean editing message bodies, where a URL is prose rather than a reference.
 *
 * Returns how many references moved, which is the number worth logging when
 * something looks stale.
 */
function retargetUrl(from: string, to: string): number {
    const hits: (string | number)[][] = []

    // Object.keys covers arrays too, so this needs no separate array branch.
    const find = (node: Record<string, unknown>, path: (string | number)[]): void => {
        for (const key of Object.keys(node)) {
            const value = node[key]
            if (typeof value === 'string') {
                if (value === from) hits.push([...path, key])
            } else if (value && typeof value === 'object') {
                find(value as Record<string, unknown>, [...path, key])
            }
        }
    }

    // Only persisted roots: a reference anywhere else is not stored state.
    // `currentChat.gameState` is skipped for the same reason even though it
    // holds item icons — it is derived from message blocks and recomputed on
    // the next turn, so a value written here would be silently reverted.
    const root = unwrap(state) as unknown as Record<string, unknown>
    find(root.assets as Record<string, unknown>, ['assets'])
    find(root.userPreferences as Record<string, unknown>, ['userPreferences'])
    find(root.extensionState as Record<string, unknown>, ['extensionState'])

    const chat = root.currentChat as Record<string, unknown>
    for (const key of Object.keys(chat)) {
        if (key === 'gameState') continue
        const value = chat[key]
        if (typeof value === 'string') {
            if (value === from) hits.push(['currentChat', key])
        } else if (value && typeof value === 'object') {
            find(value as Record<string, unknown>, ['currentChat', key])
        }
    }

    if (hits.length === 0) return 0

    mutate(s => {
        for (const path of hits) {
            let node = s as unknown as Record<string | number, unknown>
            for (const step of path.slice(0, -1)) {
                node = node[step] as Record<string | number, unknown>
            }
            node[path[path.length - 1]!] = to
        }
    })

    return hits.length
}
