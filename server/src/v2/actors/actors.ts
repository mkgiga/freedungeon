import { z } from 'zod'
import { router, procedure } from '../../trpc'
import { state, setState, deleteState } from '../../server'
import { deleteActor } from '../../db'
import { nanoid } from 'nanoid'
import type { Actor } from '@shared/types'

export const actorsRouter = router({
    list: procedure
        .query(() => {
            return Object.values(state.assets.actors)
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
        }))
        .mutation(({ input }) => {
            const now = Date.now()

            if (input.id !== undefined && state.assets.actors[input.id]) {
                const id = input.id
                const existing = state.assets.actors[id]
                setState('assets', 'actors', id, {
                    ...existing,
                    name: input.name,
                    description: input.description,
                    avatarUrl: input.avatarUrl,
                    customId: input.customId ?? existing!.customId,
                    expressions: input.expressions,
                    updatedAt: now,
                })
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
                createdAt: now,
                updatedAt: now,
            }
            setState('assets', 'actors', newId, actor)
            return actor
        }),

    delete: procedure
        .input(z.object({ id: z.string() }))
        .mutation(({ input }) => {
            deleteState('assets', 'actors', input.id)
            deleteActor(input.id)
            return { success: true }
        }),

    deleteExpression: procedure
        .input(z.object({ actorId: z.string(), name: z.string() }))
        .mutation(({ input }) => {
            const actor = state.assets.actors[input.actorId]
            if (!actor) throw new Error('Actor not found')

            deleteState('assets', 'actors', input.actorId, 'expressions', input.name)
            return { success: true }
        }),
})
