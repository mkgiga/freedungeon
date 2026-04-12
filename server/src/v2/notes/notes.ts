import { z } from 'zod'
import { router, procedure } from '../../trpc'
import { state, setState, deleteState } from '../../server'
import { nanoid } from 'nanoid'
import type { Note } from '@shared/types'

export const notesRouter = router({
    list: procedure
        .query(() => {
            return Object.values(state.assets.notes)
        }),

    get: procedure
        .input(z.object({ id: z.string() }))
        .query(({ input }) => {
            return state.assets.notes[input.id] ?? null
        }),

    upsert: procedure
        .input(z.object({
            id: z.string().optional(),
            title: z.string().min(1),
            type: z.string().optional().default(''),
            content: z.string().optional().default(''),
        }))
        .mutation(({ input }) => {
            const now = Date.now()

            if (input.id !== undefined && state.assets.notes[input.id]) {
                const id = input.id
                const existing = state.assets.notes[id]
                setState('assets', 'notes', id, {
                    ...existing,
                    title: input.title,
                    type: input.type,
                    content: input.content,
                    updatedAt: now,
                })
                return state.assets.notes[id]
            }

            const newId = nanoid()
            const note: Note = {
                id: newId,
                title: input.title,
                type: input.type,
                content: input.content,
                createdAt: now,
                updatedAt: now,
            }
            setState('assets', 'notes', newId, note)
            return note
        }),

    delete: procedure
        .input(z.object({ id: z.string() }))
        .mutation(({ input }) => {
            deleteState('assets', 'notes', input.id)
            return { success: true }
        }),
})
