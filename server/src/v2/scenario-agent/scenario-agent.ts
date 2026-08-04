import { z } from 'zod'
import { router, procedure } from '../../trpc'
import { runScenarioTurn, activeLlmConfig } from '../../scenario-turn'
import { SCENARIO_TOOLS } from '@shared/scenario-agent/tools'
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
