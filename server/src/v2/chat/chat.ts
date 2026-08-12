import { z } from 'zod'
import { router, procedure } from '../../trpc'
import { mutate, state } from '../../server'
import { CurrentChat, logChat } from '../../chat'
import { parseBlocks } from '@shared/blocks'
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
            avatarUrl: z.string().optional(),
            bannerUrl: z.string().optional(),
            description: z.string().optional(),
            actors: z.array(z.string()).optional().default([]),
            notes: z.array(z.string()).optional().default([]),
            images: z.array(z.string()).optional().default([]),
        }))
        .mutation(({ input }) => {
            const now = Date.now()
            const newId = nanoid()

            const chat: Chat = {
                id: newId,
                title: input.title,
                assets: { actors: [...input.actors], notes: Object.fromEntries(input.notes.map(id => [id, { enabled: true }])), images: [...(input.images ?? [])] },
                isTemplate: input.isTemplate,
                kind: 'roleplay' as const,
                homeChatId: null,
                avatarUrl: input.avatarUrl || undefined,
                bannerUrl: input.bannerUrl || undefined,
                description: input.description || undefined,
                createdAt: now,
                updatedAt: now,
            }

            // Add to in-memory asset library; auto-save handles persistence
            mutate(s => { s.assets.chats[newId] = chat })

            // Populate currentChat only for regular chats — templates are edited
            // via the detail view, not the conversation view.
            if (!input.isTemplate) {
                mutate(s => { s.currentChat = {
                    id: newId,
                    title: chat.title,
                    // `images` was missing here: setStore replaces `assets`
                    // wholesale rather than deep-merging, so a new chat's
                    // currentChat.assets.images was silently undefined.
                    assets: { actors: [...chat.assets.actors], notes: { ...chat.assets.notes }, images: [...chat.assets.images] },
                    messages: {},
                    gameState: { inventory: {}, itemDefs: {}, scene: { actors: { active: {}, offscreen: {} } }, flags: {} },
                    agentRehydration: null,
                    pendingSystemNotice: '',
                    createdAt: now,
                    updatedAt: now,
                } })
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
                images: z.array(z.string()).optional(),
            }),
        }))
        .mutation(({ input }) => {
            const chat = state.assets.chats[input.id]
            if (!chat) throw new Error(`Chat ${input.id} not found`)

            const now = Date.now()
            const { title, avatarUrl, bannerUrl, description, actors, notes, images } = input.patch
            const isCurrent = state.currentChat.id === input.id

            if (title !== undefined) {
                mutate(s => { s.assets.chats[input.id]!.title = title })
                if (isCurrent) mutate(s => { s.currentChat.title = title })
            }
            if (avatarUrl !== undefined) {
                mutate(s => { s.assets.chats[input.id]!.avatarUrl = avatarUrl || undefined })
            }
            if (bannerUrl !== undefined) {
                mutate(s => { s.assets.chats[input.id]!.bannerUrl = bannerUrl || undefined })
            }
            if (description !== undefined) {
                mutate(s => { s.assets.chats[input.id]!.description = description || undefined })
            }
            if (actors !== undefined) {
                mutate(s => { s.assets.chats[input.id]!.assets.actors = actors })
                if (isCurrent) mutate(s => { s.currentChat.assets.actors = actors })
            }
            if (images !== undefined) {
                mutate(s => { s.assets.chats[input.id]!.assets.images = images })
                if (isCurrent) mutate(s => { s.currentChat.assets.images = images })
            }
            if (notes !== undefined) {
                // Diff per-key: Solid stores merge object writes, so setting a
                // whole Record would leave removed keys behind. New notes
                // default to enabled; retained notes keep their flag.
                const prev = chat.assets.notes
                const keep = new Set(notes)
                for (const id of Object.keys(prev)) {
                    if (!keep.has(id)) {
                        mutate(s => { delete s.assets.chats[input.id]!.assets.notes[id] })
                        if (isCurrent) mutate(s => { delete s.currentChat.assets.notes[id] })
                    }
                }
                for (const id of notes) {
                    if (!prev[id]) {
                        mutate(s => { s.assets.chats[input.id]!.assets.notes[id] = { enabled: true } })
                        if (isCurrent) mutate(s => { s.currentChat.assets.notes[id] = { enabled: true } })
                    }
                }
            }

            mutate(s => { s.assets.chats[input.id]!.updatedAt = now })
            if (isCurrent) mutate(s => { s.currentChat.updatedAt = now })

            return { success: true }
        }),

    rename: procedure
        .input(z.object({ id: z.string(), title: z.string().min(1) }))
        .mutation(({ input }) => {
            if (!state.assets.chats[input.id]) {
                throw new Error(`Chat ${input.id} not found`)
            }
            const now = Date.now()
            mutate(s => { s.assets.chats[input.id]!.title = input.title })
            mutate(s => { s.assets.chats[input.id]!.updatedAt = now })
            // If it's the current chat, also update its title in currentChat
            if (state.currentChat.id === input.id) {
                mutate(s => { s.currentChat.title = input.title })
                mutate(s => { s.currentChat.updatedAt = now })
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
            mutate(s => { s.currentChat.assets.actors = next })
            mutate(s => { s.assets.chats[chatId]!.assets.actors = next })
            mutate(s => { s.currentChat.updatedAt = now })
            mutate(s => { s.assets.chats[chatId]!.updatedAt = now })
            return { success: true }
        }),

    removeActor: procedure
        .input(z.object({ actorId: z.string() }))
        .mutation(({ input }) => {
            const chatId = state.currentChat.id
            if (!chatId) throw new Error('No chat loaded')

            const next = state.currentChat.assets.actors.filter(id => id !== input.actorId)
            const now = Date.now()
            mutate(s => { s.currentChat.assets.actors = next })
            mutate(s => { s.assets.chats[chatId]!.assets.actors = next })
            mutate(s => { s.currentChat.updatedAt = now })
            mutate(s => { s.assets.chats[chatId]!.updatedAt = now })
            return { success: true }
        }),

    addNote: procedure
        .input(z.object({ noteId: z.string() }))
        .mutation(({ input }) => {
            const chatId = state.currentChat.id
            if (!chatId) throw new Error('No chat loaded')
            if (!state.assets.notes[input.noteId]) throw new Error('Note not found')

            if (state.currentChat.assets.notes[input.noteId]) return { success: true }

            const now = Date.now()
            mutate(s => { s.currentChat.assets.notes[input.noteId] = { enabled: true } })
            mutate(s => { s.assets.chats[chatId]!.assets.notes[input.noteId] = { enabled: true } })
            mutate(s => { s.currentChat.updatedAt = now })
            mutate(s => { s.assets.chats[chatId]!.updatedAt = now })
            return { success: true }
        }),

    removeNote: procedure
        .input(z.object({ noteId: z.string() }))
        .mutation(({ input }) => {
            const chatId = state.currentChat.id
            if (!chatId) throw new Error('No chat loaded')

            const now = Date.now()
            mutate(s => { delete s.currentChat.assets.notes[input.noteId] })
            mutate(s => { delete s.assets.chats[chatId]!.assets.notes[input.noteId] })
            mutate(s => { s.currentChat.updatedAt = now })
            mutate(s => { s.assets.chats[chatId]!.updatedAt = now })
            return { success: true }
        }),

    setNoteEnabled: procedure
        .input(z.object({ noteId: z.string(), enabled: z.boolean() }))
        .mutation(({ input }) => {
            const chatId = state.currentChat.id
            if (!chatId) throw new Error('No chat loaded')
            if (!state.currentChat.assets.notes[input.noteId]) throw new Error('Note is not attached to this chat')

            mutate(s => { s.currentChat.assets.notes[input.noteId]!.enabled = input.enabled })
            mutate(s => { s.assets.chats[chatId]!.assets.notes[input.noteId]!.enabled = input.enabled })
            return { success: true }
        }),

    setPendingSystemNotice: procedure
        .input(z.object({ text: z.string() }))
        .mutation(({ input }) => {
            if (!state.currentChat.id) throw new Error('No chat loaded')
            mutate(s => { s.currentChat.pendingSystemNotice = input.text })
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
            // Eviction of residents and removal of the collaborator
            // conversation are declared in cascade.ts and run from deleteState.

            // DB delete via persistPath; CASCADE removes chat_messages,
            // chat_actor_refs, and chat_note_refs for this chat.
            mutate(s => { delete s.assets.chats[input.id] })

            // If the deleted chat was current, clear currentChat
            if (state.currentChat.id === input.id) {
                mutate(s => { s.currentChat = {
                    id: null,
                    title: '',
                    assets: { actors: [], notes: {}, images: [] },
                    messages: {},
                    gameState: { inventory: {}, itemDefs: {}, scene: { actors: { active: {}, offscreen: {} } }, flags: {} },
                    agentRehydration: null,
                    pendingSystemNotice: '',
                    createdAt: null,
                    updatedAt: null,
                } })
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

    chooseOption: procedure
        .input(z.object({ messageId: z.string(), optionIndex: z.number().int().min(0) }))
        .mutation(async ({ input }) => {
            const currentChat = state.currentChat
            if (!currentChat.id) throw new Error('No chat loaded')
            if (state.isGenerating) {
                throw new Error('Generation is already in progress. Please wait until it finishes.')
            }

            const msg = currentChat.messages[input.messageId]
            if (!msg) throw new Error(`Message ${input.messageId} not found in current chat`)

            const promptBlock = parseBlocks(msg.content).find(b => b.type === 'choicePrompt')
            if (!promptBlock || promptBlock.type !== 'choicePrompt') {
                throw new Error('Message is not a choice prompt')
            }
            const optionText = promptBlock.options[input.optionIndex]
            if (optionText === undefined) throw new Error('Invalid option index')

            // Stamp the chosen index so history renders the pick (highlight +
            // dim the rest). Mirrors the metadata-stamp pattern in agent.ts.
            const updated = {
                ...msg,
                metadata: { ...(msg.metadata ?? {}), chosenIndex: input.optionIndex },
                updatedAt: Date.now(),
            }
            mutate(s => { s.currentChat.messages[input.messageId] = updated })

            // Submit the pick as a distinct `choice(...)` user message (vs the
            // normal `unformatted(...)`), then let the agent respond.
            CurrentChat.prompt({ message: `choice(${JSON.stringify(optionText)});` })
            return { success: true }
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
        .mutation(async ({ input }) => {
            if (!CurrentChat.getMessage(input.id)) {
                throw new Error(`Message ${input.id} not found in current chat`)
            }
            await CurrentChat.rewindToMessage(input.id)
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
        .mutation(async () => {
            if (!state.isGenerating) {
                logChat(`No generation in progress. Nothing to cancel.`);
                return { success: false, message: 'No generation in progress. Nothing to cancel.' };
            }

            const { cancelAgentTurn } = await import('../../agent')
            await cancelAgentTurn()
            mutate(s => { s.isGenerating = false })
            return { success: true }
        }),
})
