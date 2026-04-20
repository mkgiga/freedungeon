import { z } from 'zod'
import { router, procedure } from '../../trpc'
import { state, setState, deleteState } from '../../server'
import { CurrentChat, logChat } from '../../chat'
import { ChatCompletionManager } from '../../llm'
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
        .input(z.object({
            title: z.string().optional().default('Untitled Chat'),
            isTemplate: z.boolean().optional().default(false),
        }))
        .mutation(({ input }) => {
            const now = Date.now()
            const newId = nanoid()

            const chat: Chat = {
                id: newId,
                title: input.title,
                assets: { actors: [], notes: [] },
                hotbarNotes: {},
                isTemplate: input.isTemplate,
                createdAt: now,
                updatedAt: now,
            }

            // Add to in-memory asset library; auto-save handles persistence
            setState('assets', 'chats', newId, chat)

            // Populate currentChat only for regular chats — templates are edited
            // via the detail view, not the conversation view.
            if (!input.isTemplate) {
                setState('currentChat', {
                    id: newId,
                    title: chat.title,
                    assets: { actors: [], notes: [] },
                    hotbarNotes: {},
                    messages: {},
                    createdAt: now,
                    updatedAt: now,
                })
            }

            return { id: newId }
        }),

    update: procedure
        .input(z.object({
            id: z.string(),
            patch: z.object({
                title: z.string().optional(),
                avatarUrl: z.string().optional(),
                bannerUrl: z.string().optional(),
                description: z.string().optional(),
                actors: z.array(z.string()).optional(),
                notes: z.array(z.string()).optional(),
            }),
        }))
        .mutation(({ input }) => {
            const chat = state.assets.chats[input.id]
            if (!chat) throw new Error(`Chat ${input.id} not found`)

            const now = Date.now()
            const { title, avatarUrl, bannerUrl, description, actors, notes } = input.patch
            const isCurrent = state.currentChat.id === input.id

            if (title !== undefined) {
                setState('assets', 'chats', input.id, 'title', title)
                if (isCurrent) setState('currentChat', 'title', title)
            }
            if (avatarUrl !== undefined) {
                setState('assets', 'chats', input.id, 'avatarUrl', avatarUrl || undefined)
            }
            if (bannerUrl !== undefined) {
                setState('assets', 'chats', input.id, 'bannerUrl', bannerUrl || undefined)
            }
            if (description !== undefined) {
                setState('assets', 'chats', input.id, 'description', description || undefined)
            }
            if (actors !== undefined) {
                setState('assets', 'chats', input.id, 'assets', 'actors', actors)
                if (isCurrent) setState('currentChat', 'assets', 'actors', actors)
            }
            if (notes !== undefined) {
                setState('assets', 'chats', input.id, 'assets', 'notes', notes)
                if (isCurrent) setState('currentChat', 'assets', 'notes', notes)
            }

            setState('assets', 'chats', input.id, 'updatedAt', now)
            if (isCurrent) setState('currentChat', 'updatedAt', now)

            return { success: true }
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

    addActor: procedure
        .input(z.object({ actorId: z.string() }))
        .mutation(({ input }) => {
            const chatId = state.currentChat.id
            if (!chatId) throw new Error('No chat loaded')
            if (!state.assets.actors[input.actorId]) throw new Error('Actor not found')

            const current = state.currentChat.assets.actors
            if (current.includes(input.actorId)) return { success: true }

            const next = [...current, input.actorId]
            const now = Date.now()
            setState('currentChat', 'assets', 'actors', next)
            setState('assets', 'chats', chatId, 'assets', 'actors', next)
            setState('currentChat', 'updatedAt', now)
            setState('assets', 'chats', chatId, 'updatedAt', now)
            return { success: true }
        }),

    removeActor: procedure
        .input(z.object({ actorId: z.string() }))
        .mutation(({ input }) => {
            const chatId = state.currentChat.id
            if (!chatId) throw new Error('No chat loaded')

            const next = state.currentChat.assets.actors.filter(id => id !== input.actorId)
            const now = Date.now()
            setState('currentChat', 'assets', 'actors', next)
            setState('assets', 'chats', chatId, 'assets', 'actors', next)
            setState('currentChat', 'updatedAt', now)
            setState('assets', 'chats', chatId, 'updatedAt', now)
            return { success: true }
        }),

    addNote: procedure
        .input(z.object({ noteId: z.string() }))
        .mutation(({ input }) => {
            const chatId = state.currentChat.id
            if (!chatId) throw new Error('No chat loaded')
            if (!state.assets.notes[input.noteId]) throw new Error('Note not found')

            const current = state.currentChat.assets.notes
            if (current.includes(input.noteId)) return { success: true }

            const next = [...current, input.noteId]
            const now = Date.now()
            setState('currentChat', 'assets', 'notes', next)
            setState('assets', 'chats', chatId, 'assets', 'notes', next)
            setState('currentChat', 'updatedAt', now)
            setState('assets', 'chats', chatId, 'updatedAt', now)
            return { success: true }
        }),

    removeNote: procedure
        .input(z.object({ noteId: z.string() }))
        .mutation(({ input }) => {
            const chatId = state.currentChat.id
            if (!chatId) throw new Error('No chat loaded')

            const next = state.currentChat.assets.notes.filter(id => id !== input.noteId)
            const now = Date.now()
            setState('currentChat', 'assets', 'notes', next)
            setState('assets', 'chats', chatId, 'assets', 'notes', next)
            setState('currentChat', 'updatedAt', now)
            setState('assets', 'chats', chatId, 'updatedAt', now)
            return { success: true }
        }),

    setHotbarNote: procedure
        .input(z.object({ noteId: z.string(), enabled: z.boolean() }))
        .mutation(({ input }) => {
            const chatId = state.currentChat.id
            if (!chatId) throw new Error('No chat loaded')
            if (!state.assets.notes[input.noteId]) throw new Error('Note not found')

            const entry = { enabled: input.enabled }
            setState('currentChat', 'hotbarNotes', input.noteId, entry)
            setState('assets', 'chats', chatId, 'hotbarNotes', input.noteId, entry)
            return { success: true }
        }),

    toggleHotbarNote: procedure
        .input(z.object({ noteId: z.string() }))
        .mutation(({ input }) => {
            const chatId = state.currentChat.id
            if (!chatId) throw new Error('No chat loaded')
            if (!state.assets.notes[input.noteId]) throw new Error('Note not found')

            const existing = state.currentChat.hotbarNotes[input.noteId]
            const entry = { enabled: existing ? !existing.enabled : true }
            setState('currentChat', 'hotbarNotes', input.noteId, entry)
            setState('assets', 'chats', chatId, 'hotbarNotes', input.noteId, entry)
            return { success: true }
        }),

    removeHotbarNote: procedure
        .input(z.object({ noteId: z.string() }))
        .mutation(({ input }) => {
            const chatId = state.currentChat.id
            if (!chatId) throw new Error('No chat loaded')

            deleteState('currentChat', 'hotbarNotes', input.noteId)
            deleteState('assets', 'chats', chatId, 'hotbarNotes', input.noteId)
            return { success: true }
        }),

    saveAsTemplate: procedure
        .input(z.object({ sourceChatId: z.string(), newTitle: z.string().optional() }))
        .mutation(async ({ input }) => {
            const source = state.assets.chats[input.sourceChatId]
            if (!source) throw new Error('Source chat not found')
            const title = input.newTitle ?? `Template: ${source.title}`
            const id = await CurrentChat.cloneChat(input.sourceChatId, { newTitle: title, asTemplate: true })
            return { id }
        }),

    useTemplate: procedure
        .input(z.object({ templateId: z.string(), newTitle: z.string().optional() }))
        .mutation(async ({ input }) => {
            const source = state.assets.chats[input.templateId]
            if (!source) throw new Error('Template not found')
            if (!source.isTemplate) throw new Error('Chat is not a template')
            const title = input.newTitle ?? source.title
            const id = await CurrentChat.cloneChat(input.templateId, { newTitle: title, asTemplate: false })
            await CurrentChat.loadChat(id)
            return { id }
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
                    hotbarNotes: {},
                    messages: {},
                    createdAt: null,
                    updatedAt: null,
                })
            }

            return { success: true }
        }),

    prompt: procedure
        .input(z.object({ message: z.string() }))
        .mutation(async ({ input }) => {
            const currentChat = state.currentChat;
            if (!currentChat.id) {
                throw new Error('No chat loaded')
            }
            if (state.isGenerating) {
                logChat(`Generation is already in progress. Exiting now.`);
                throw new Error('Generation is already in progress. Please wait until the current generation finishes before sending a new message.');
            }
            
            CurrentChat.prompt({ message: input.message });
        }),

    deleteMessage: procedure
        .input(z.object({ id: z.string() }))
        .mutation(({ input }) => {
            if (!CurrentChat.getMessage(input.id)) {
                throw new Error(`Message ${input.id} not found in current chat`)
            }
            CurrentChat.deleteMessage(input.id)
            return { success: true }
        }),

    regenerateMessage: procedure
        .input(z.object({ id: z.string() }))
        .mutation(async ({ input }) => {
            if (!CurrentChat.getMessage(input.id)) {
                throw new Error(`Message ${input.id} not found in current chat`)
            }
            await CurrentChat.regenerateMessage(input.id)
            return { success: true }
        }),

    rewindToMessage: procedure
        .input(z.object({ id: z.string() }))
        .mutation(({ input }) => {
            if (!CurrentChat.getMessage(input.id)) {
                throw new Error(`Message ${input.id} not found in current chat`)
            }
            CurrentChat.rewindToMessage(input.id)
            return { success: true }
        }),

    branchFromMessage: procedure
        .input(z.object({ id: z.string() }))
        .mutation(async ({ input }) => {
            if (!CurrentChat.getMessage(input.id)) {
                throw new Error(`Message ${input.id} not found in current chat`)
            }
            await CurrentChat.branchFromTargetMessage({
                messageId: input.id,
                newTitle: 'branch',
            })
            return { success: true }
        }),

    updateMessage: procedure
        .input(z.object({ id: z.string(), content: z.string() }))
        .mutation(({ input }) => {
            if (!CurrentChat.getMessage(input.id)) {
                throw new Error(`Message ${input.id} not found in current chat`)
            }
            CurrentChat.editMessage({ messageId: input.id, newContent: input.content })
            return { success: true }
        }),

    cancel: procedure
        .mutation(() => {
            if (!state.isGenerating) {
                logChat(`No generation in progress. Nothing to cancel.`);
                return { success: false, message: 'No generation in progress. Nothing to cancel.' };
            }

            ChatCompletionManager.cancel();
            return { success: true }
        }),
})
