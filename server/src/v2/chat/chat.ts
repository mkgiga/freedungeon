import { z } from 'zod'
import { router, procedure } from '../../trpc'
import { state, setState, deleteState } from '../../server'
import { CurrentChat } from '../../chat'
import { deleteChat } from '../../db'
import { nanoid } from 'nanoid'
import type { Chat } from '@shared/types'

export const chatRouter = router({
    list: procedure
        .query(() => {
            return Object.values(state.assets.chats)
        }),

    load: procedure
        .input(z.object({ id: z.string() }))
        .mutation(async ({ input }) => {
            await CurrentChat.loadChat(input.id)
            return { id: input.id }
        }),

    create: procedure
        .input(z.object({ title: z.string().optional().default('Untitled Chat') }))
        .mutation(({ input }) => {
            const now = Date.now()
            const newId = nanoid()

            const chat: Chat = {
                id: newId,
                title: input.title,
                assets: { actors: [], notes: [] },
                createdAt: now,
                updatedAt: now,
            }

            // Add to in-memory asset library; auto-save handles persistence
            setState('assets', 'chats', newId, chat)

            // Populate currentChat directly from the in-memory chat (no DB round-trip).
            // The chat doesn't exist in the DB yet — that happens on the next auto-save.
            setState('currentChat', {
                id: newId,
                title: chat.title,
                assets: { actors: [], notes: [] },
                messages: {},
                createdAt: now,
                updatedAt: now,
            })

            return { id: newId }
        }),

    rename: procedure
        .input(z.object({ id: z.string(), title: z.string().min(1) }))
        .mutation(({ input }) => {
            if (!state.assets.chats[input.id]) {
                throw new Error(`Chat ${input.id} not found`)
            }
            const now = Date.now()
            setState('assets', 'chats', input.id, 'title', input.title)
            setState('assets', 'chats', input.id, 'updatedAt', now)
            // If it's the current chat, also update its title in currentChat
            if (state.currentChat.id === input.id) {
                setState('currentChat', 'title', input.title)
                setState('currentChat', 'updatedAt', now)
            }
            return { success: true }
        }),

    delete: procedure
        .input(z.object({ id: z.string() }))
        .mutation(({ input }) => {
            // Remove from state and DB together. CASCADE deletes chat_messages,
            // chat_actor_refs, and chat_note_refs for this chat.
            deleteState('assets', 'chats', input.id)
            deleteChat(input.id)

            // If the deleted chat was current, clear currentChat
            if (state.currentChat.id === input.id) {
                setState('currentChat', {
                    id: null,
                    title: '',
                    assets: { actors: [], notes: [] },
                    messages: {},
                    createdAt: null,
                    updatedAt: null,
                })
            }

            return { success: true }
        }),
})
