import { z } from 'zod'
import { router, procedure } from '../../trpc'
import { state, setState, deleteState } from '../../server'
import { nanoid } from 'nanoid'
import type { Actor } from '@shared/types'
import { inLibrary, homedIn } from '@shared/visibility'

export const actorsRouter = router({
    list: procedure
        .query(() => {
            // The global library is "not deleted, and not authored for a
            // Scenario". Scenario residents are reachable through that
            // Scenario, not here.
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
            /** Author this actor into a Scenario instead of the global library. */
            homeChatId: z.string().nullish(),
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
                    // Only when explicitly supplied — an edit from the Actors
                    // screen omits it and must not relocate the actor.
                    ...(input.homeChatId !== undefined ? { homeChatId: input.homeChatId ?? null } : {}),
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
                homeChatId: input.homeChatId ?? null,
                createdAt: now,
                updatedAt: now,
            }
            setState('assets', 'actors', newId, actor)
            return actor
        }),

    /**
     * Soft delete. The row stays so chat history keeps resolving this actor's
     * portrait and expressions — every library, picker and agent tool filters
     * on `deletedAt` instead. See shared/visibility.ts.
     */
    delete: procedure
        .input(z.object({ id: z.string() }))
        .mutation(({ input }) => {
            const actor = state.assets.actors[input.id]
            if (!actor) return { success: true }
            setState('assets', 'actors', input.id, { ...actor, deletedAt: Date.now() })
            return { success: true }
        }),

    restore: procedure
        .input(z.object({ id: z.string() }))
        .mutation(({ input }) => {
            const actor = state.assets.actors[input.id]
            if (!actor) throw new Error('Actor not found')
            setState('assets', 'actors', input.id, { ...actor, deletedAt: null })
            return { success: true }
        }),

    /** A Scenario's private cast — what it authored, not what it merely uses. */
    listHomedIn: procedure
        .input(z.object({ chatId: z.string() }))
        .query(({ input }) => homedIn(Object.values(state.assets.actors), input.chatId)),

    /**
     * Move an actor between the global library and a Scenario. `homeChatId:
     * null` promotes it to the library; a chat id adopts it into that Scenario.
     * Attachments are untouched — where something lives and where it's used are
     * different questions.
     */
    setHome: procedure
        .input(z.object({ id: z.string(), homeChatId: z.string().nullable() }))
        .mutation(({ input }) => {
            const actor = state.assets.actors[input.id]
            if (!actor) throw new Error('Actor not found')
            if (input.homeChatId && !state.assets.chats[input.homeChatId]) {
                throw new Error('Target chat not found')
            }
            setState('assets', 'actors', input.id, {
                ...actor, homeChatId: input.homeChatId, updatedAt: Date.now(),
            })
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
