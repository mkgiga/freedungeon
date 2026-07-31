import { z } from 'zod'
import { router, procedure } from '../../trpc'
import { state, setState, deleteState } from '../../server'
import { nanoid } from 'nanoid'
import type { ImageAsset } from '@shared/types'

/**
 * The curated image library. Rows here are images a user attached to a chat
 * (typically a template) for the agent to bring on screen by `key` — see
 * ImageAsset for why agent-generated images deliberately stay out.
 *
 * This router owns the library itself. Which images a given chat carries is set
 * through `chat.update`'s `images` array, the same way its actors are — see
 * v2/chat/chat.ts.
 */
export const imagesRouter = router({
    list: procedure
        .query(() => Object.values(state.assets.images)),

    /**
     * Register an already-uploaded file (POST /uploads gives you the URL) as a
     * library image. `key` must be unique — it's the agent's handle for it.
     */
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
            setState('assets', 'images', image.id, image)
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

            setState('assets', 'images', input.id, {
                ...existing,
                ...(input.key ? { key: input.key } : {}),
                ...(input.label ? { label: input.label } : {}),
                updatedAt: Date.now(),
            })
            return { success: true }
        }),

    /** Deletes the library row. CASCADE drops every chat's ref to it. */
    delete: procedure
        .input(z.object({ id: z.string() }))
        .mutation(({ input }) => {
            deleteState('assets', 'images', input.id)

            // The store's chat copies aren't touched by the CASCADE, so drop
            // the id from each one that held it.
            for (const chat of Object.values(state.assets.chats)) {
                if (!chat.assets.images?.includes(input.id)) continue
                setState('assets', 'chats', chat.id, 'assets', 'images',
                    chat.assets.images.filter(id => id !== input.id))
            }
            if (state.currentChat.id && state.currentChat.assets.images?.includes(input.id)) {
                setState('currentChat', 'assets', 'images',
                    state.currentChat.assets.images.filter(id => id !== input.id))
            }
            return { success: true }
        }),

})
