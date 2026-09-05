import { z } from 'zod'
import { router, procedure } from '../../trpc'
import { mutate, state } from '../../server'
import { nanoid } from 'nanoid'
import type { Actor } from '@shared/types'
import { inLibrary, homedIn } from '@shared/visibility'

export const actorsRouter = router({
    list: procedure
        .query(() => {
            return inLibrary(Object.values(state.assets.actors))
        }),

    get: procedure
        .input(z.object({ id: z.string() }))
        .query(({ input }) => {
            return state.assets.actors[input.id] ?? null
        }),

    upsert: procedure
        .input(z.object({
            id: z.string().optional(),
            name: z.string().min(1),
            description: z.string().optional().default(''),
            avatarUrl: z.string().optional().default(''),
            customId: z.string().optional(),
            expressions: z.record(z.string(), z.string()).optional().default({}),
            homeChatId: z.string().nullish(),
        }))
        .mutation(({ input }) => {
            if (input.homeChatId && !state.assets.chats[input.homeChatId]) {
                throw new Error('Target chat not found')
            }
            const now = Date.now()

            if (input.id !== undefined && state.assets.actors[input.id]) {
                const id = input.id
                const existing = state.assets.actors[id]
                mutate(s => { s.assets.actors[id] = {
                    ...existing!,
                    name: input.name,
                    description: input.description,
                    avatarUrl: input.avatarUrl,
                    customId: input.customId ?? existing!.customId,
                    expressions: input.expressions,
                    ...(input.homeChatId !== undefined ? { homeChatId: input.homeChatId ?? null } : {}),
                    updatedAt: now,
                } })
                return state.assets.actors[id]
            }

            const newId = nanoid()
            const actor: Actor = {
                id: newId,
                customId: input.customId ?? nanoid(12),
                name: input.name,
                description: input.description,
                avatarUrl: input.avatarUrl,
                expressions: input.expressions,
                homeChatId: input.homeChatId ?? null,
                createdAt: now,
                updatedAt: now,
            }
            mutate(s => { s.assets.actors[newId] = actor })
            return actor
        }),

    delete: procedure
        .input(z.object({ id: z.string() }))
        .mutation(({ input }) => {
            const actor = state.assets.actors[input.id]
            if (!actor) return { success: true }
            mutate(s => { s.assets.actors[input.id] = { ...actor, deletedAt: Date.now() } })
            return { success: true }
        }),

    restore: procedure
        .input(z.object({ id: z.string() }))
        .mutation(({ input }) => {
            const actor = state.assets.actors[input.id]
            if (!actor) throw new Error('Actor not found')
            mutate(s => { s.assets.actors[input.id] = { ...actor, deletedAt: null } })
            return { success: true }
        }),

    listHomedIn: procedure
        .input(z.object({ chatId: z.string() }))
        .query(({ input }) => homedIn(Object.values(state.assets.actors), input.chatId)),

    setHome: procedure
        .input(z.object({ id: z.string(), homeChatId: z.string().nullable() }))
        .mutation(({ input }) => {
            const actor = state.assets.actors[input.id]
            if (!actor) throw new Error('Actor not found')
            if (input.homeChatId && !state.assets.chats[input.homeChatId]) {
                throw new Error('Target chat not found')
            }
            mutate(s => { s.assets.actors[input.id] = {
                ...actor, homeChatId: input.homeChatId, updatedAt: Date.now(),
            } })
            return { success: true }
        }),

    deleteExpression: procedure
        .input(z.object({ actorId: z.string(), name: z.string() }))
        .mutation(({ input }) => {
            const actor = state.assets.actors[input.actorId]
            if (!actor) throw new Error('Actor not found')

            mutate(s => { delete s.assets.actors[input.actorId]!.expressions[input.name] })
            return { success: true }
        }),
})
