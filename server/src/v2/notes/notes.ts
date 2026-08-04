import { z } from 'zod'
import { router, procedure } from '../../trpc'
import { state, setState } from '../../server'
import { nanoid } from 'nanoid'
import type { Note } from '@shared/types'
import { inLibrary, homedIn } from '@shared/visibility'

export const notesRouter = router({
    list: procedure
        .query(() => {
            return inLibrary(Object.values(state.assets.notes))
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
            emoji: z.string().optional(),
            /** Author this note into a Scenario instead of the global library. */
            homeChatId: z.string().nullish(),
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
                    emoji: input.emoji,
                    // Only when explicitly supplied — see actors.upsert.
                    ...(input.homeChatId !== undefined ? { homeChatId: input.homeChatId ?? null } : {}),
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
                emoji: input.emoji,
                homeChatId: input.homeChatId ?? null,
                createdAt: now,
                updatedAt: now,
            }
            setState('assets', 'notes', newId, note)
            return note
        }),

    /** Soft delete — see actors.delete and shared/visibility.ts. */
    delete: procedure
        .input(z.object({ id: z.string() }))
        .mutation(({ input }) => {
            const note = state.assets.notes[input.id]
            if (!note) return { success: true }
            setState('assets', 'notes', input.id, { ...note, deletedAt: Date.now() })
            return { success: true }
        }),

    restore: procedure
        .input(z.object({ id: z.string() }))
        .mutation(({ input }) => {
            const note = state.assets.notes[input.id]
            if (!note) throw new Error('Note not found')
            setState('assets', 'notes', input.id, { ...note, deletedAt: null })
            return { success: true }
        }),

    /** A Scenario's private notes — what it authored, not what it merely uses. */
    listHomedIn: procedure
        .input(z.object({ chatId: z.string() }))
        .query(({ input }) => homedIn(Object.values(state.assets.notes), input.chatId)),

    /** See actors.setHome. */
    setHome: procedure
        .input(z.object({ id: z.string(), homeChatId: z.string().nullable() }))
        .mutation(({ input }) => {
            const note = state.assets.notes[input.id]
            if (!note) throw new Error('Note not found')
            if (input.homeChatId && !state.assets.chats[input.homeChatId]) {
                throw new Error('Target chat not found')
            }
            setState('assets', 'notes', input.id, {
                ...note, homeChatId: input.homeChatId, updatedAt: Date.now(),
            })
            return { success: true }
        }),
})
