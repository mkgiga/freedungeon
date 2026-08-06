import { z } from 'zod'
import { router, procedure } from '../../trpc'
import { runScenarioTurn, activeLlmConfig } from '../../scenario-turn'
import { getScenarioAgentPrompt } from '../../system-prompt'
import type { ScenarioToolCall } from '../../scenario-agent'
import { SCENARIO_TOOLS } from '@shared/scenario-agent/tools'
import { state, setState } from '../../server'
import { nanoid } from 'nanoid'

import { saveMessage, loadChatById } from '../../db'
import type { ChatMessage } from '@shared/types'
import type { ModelMessage } from 'ai'

/**
 * The Scenario collaborator panel talks to this.
 *
 * The conversation is a real chat: messages are written as `chat_messages` rows
 * against the collaborator chat, so it survives reloads and is a foundation for
 * rewind/branch/regenerate later. It is never loaded into `currentChat` though —
 * the collaborator's tools don't consult it, so the panel can run alongside a
 * loaded roleplay chat without either disturbing the other.
 */
/**
 * The panel's view of a message. Tool calls ride along in `metadata` — the
 * column already exists, so showing what the agent did survives a reload
 * without a migration or a second message role.
 */
const toPanelMessage = (m: ChatMessage) => ({
    id: m.id,
    role: m.role,
    content: m.content,
    createdAt: m.createdAt,
    toolCalls: (m.metadata?.toolCalls ?? []) as ScenarioToolCall[],
})

export const scenarioAgentRouter = router({
    /** What the collaborator can do — for showing the user, not the model. */
    tools: procedure.query(() =>
        Object.values(SCENARIO_TOOLS).map(t => ({ name: t.name, description: t.description })),
    ),

    /**
     * The shipped instructions, so the settings dialog can show what the agent
     * is running on before the user has overridden anything — and offer a way
     * back to it afterwards.
     */
    defaultSystemPrompt: procedure.query(() => getScenarioAgentPrompt()),

    /**
     * The collaborator conversation for a Scenario, created on first use.
     *
     * It is a real chat row — so it inherits message persistence and, later,
     * rewind/branch/regenerate — but `kind: 'collaborator'` and a `homeChatId`
     * keep it out of the recent-chats list and bind its agent's scope to the
     * Scenario it belongs to.
     */
    ensureConversation: procedure
        .input(z.object({ scenarioId: z.string() }))
        .mutation(({ input }) => {
            const scenario = state.assets.chats[input.scenarioId]
            if (!scenario) throw new Error('Scenario not found')

            const existing = Object.values(state.assets.chats)
                .find(c => c.kind === 'collaborator' && c.homeChatId === input.scenarioId)
            if (existing) return { id: existing.id, created: false }

            const id = nanoid()
            const now = Date.now()
            setState('assets', 'chats', id, {
                id,
                title: `Collaborator — ${scenario.title}`,
                assets: { actors: [], notes: {}, images: [] },
                isTemplate: false,
                kind: 'collaborator',
                homeChatId: input.scenarioId,
                createdAt: now,
                updatedAt: now,
            })
            return { id, created: true }
        }),

    /** The conversation so far, read straight from its chat rows. */
    history: procedure
        .input(z.object({ conversationId: z.string() }))
        .query(async ({ input }) => {
            const chat = await loadChatById(input.conversationId).catch(() => null)
            if (!chat) return []
            return Object.values(chat.messages)
                .sort((a, b) => a.createdAt - b.createdAt)
                .map(toPanelMessage)
        }),

    send: procedure
        .input(z.object({
            /** The Scenario being authored — what the tools are scoped to. */
            scenarioId: z.string(),
            /** The collaborator chat the conversation is stored in. */
            conversationId: z.string(),
            message: z.string().min(1),
        }))
        .mutation(async ({ input }) => {
            const llmConfig = activeLlmConfig()

            const prior = await loadChatById(input.conversationId).catch(() => null)
            const history = Object.values(prior?.messages ?? {})
                .sort((a, b) => a.createdAt - b.createdAt)
                .map(m => ({ role: m.role === 'user' ? 'user' as const : 'assistant' as const, content: m.content }))

            const now = Date.now()
            const userMsg: ChatMessage = {
                id: nanoid(), role: 'user', chatId: input.conversationId,
                content: input.message, createdAt: now, updatedAt: now,
            }
            saveMessage(userMsg)

            const result = await runScenarioTurn({
                chatId: input.scenarioId,
                userMessage: input.message,
                history: history as ModelMessage[],
                llmConfig,
            })

            const replyMsg: ChatMessage = {
                id: nanoid(), role: 'assistant', chatId: input.conversationId,
                content: result.reply, createdAt: Date.now(), updatedAt: Date.now(),
                ...(result.toolCalls.length ? { metadata: { toolCalls: result.toolCalls } } : {}),
            }
            saveMessage(replyMsg)

            return {
                reply: result.reply,
                messages: [userMsg, replyMsg].map(toPanelMessage),
                provider: llmConfig.provider,
                model: llmConfig.model,
            }
        }),
})
