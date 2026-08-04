import { z } from 'zod'
import { router, procedure } from '../../trpc'
import { runScenarioTurn, activeLlmConfig } from '../../scenario-turn'
import { SCENARIO_TOOLS } from '@shared/scenario-agent/tools'
import { state, setState } from '../../server'
import { nanoid } from 'nanoid'

import type { ModelMessage } from 'ai'

/**
 * The Scenario collaborator panel talks to this.
 *
 * The conversation is deliberately client-owned and unpersisted: the panel
 * sends its history back each turn and stores whatever comes out. Nothing about
 * authoring a Scenario belongs in the chat log, and a transient conversation
 * can't drift out of sync with a session on the model's side.
 */
export const scenarioAgentRouter = router({
    /** What the collaborator can do — for showing the user, not the model. */
    tools: procedure.query(() =>
        Object.values(SCENARIO_TOOLS).map(t => ({ name: t.name, description: t.description })),
    ),

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

    send: procedure
        .input(z.object({
            chatId: z.string(),
            message: z.string().min(1),
            /** Prior turns, owned by the panel. */
            history: z.array(z.object({
                role: z.enum(['user', 'assistant']),
                content: z.string(),
            })).optional().default([]),
        }))
        .mutation(async ({ input }) => {
            const llmConfig = activeLlmConfig()
            const result = await runScenarioTurn({
                chatId: input.chatId,
                userMessage: input.message,
                history: input.history as ModelMessage[],
                llmConfig,
            })
            return {
                reply: result.reply,
                provider: llmConfig.provider,
                model: llmConfig.model,
            }
        }),
})
