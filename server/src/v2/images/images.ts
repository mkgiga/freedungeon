import { z } from 'zod'
import { router, procedure } from '../../trpc'
import { mutate, state } from '../../server'
import { nanoid } from 'nanoid'
import type { ImageAsset } from '@shared/types'

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
