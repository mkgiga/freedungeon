
import { generateText, jsonSchema, stepCountIs, tool, type ModelMessage, type Tool } from 'ai'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { z } from 'zod'
import { SCENARIO_TOOLS, type ScenarioToolName } from '@shared/scenario-agent/tools'
import { getScenarioAgentPrompt } from './system-prompt'
import { runScenarioTool, recordingToolCalls, type ScenarioToolCall } from './scenario-agent'
import { state } from './server'
import { log } from './logger'
import type { LLMConfig } from '@shared/types'

const MAX_STEPS = 24

/**
 * Absent rather than seeded on first run, so an untouched install keeps
 * following SCENARIO_AGENT.md and picks up improvements to it.
 */
export function effectiveSystemPrompt(): string {
    const override = state.userPreferences.scenarioAgent?.systemPrompt
    return override?.trim() ? override : getScenarioAgentPrompt()
}

function normalizeBaseURL(endpoint: string): string {
    return endpoint.replace(/\/chat\/completions\/?$/, '').replace(/\/+$/, '')
}

function buildTools(chatId: string): Record<string, Tool> {
    const tools: Record<string, Tool> = {}
    for (const [key, spec] of Object.entries(SCENARIO_TOOLS)) {
        tools[spec.name] = tool({
            description: spec.description,
            inputSchema: jsonSchema(z.toJSONSchema(spec.schema)),
            execute: async (args) => {
                const r = await runScenarioTool(chatId, key as ScenarioToolName, args as Record<string, unknown>)
                if ('error' in r) throw new Error(r.error)
                return r.result
            },
        })
    }
    return tools
}

export type ScenarioTurnResult = {
    reply: string
    transcript: ModelMessage[]
    toolCalls: ScenarioToolCall[]
}

/** The caller owns `history` - none of this is persisted. */
export async function runScenarioTurn(args: {
    chatId: string
    userMessage: string
    history: ModelMessage[]
    llmConfig: LLMConfig
}): Promise<ScenarioTurnResult> {
    const { value, calls } = await recordingToolCalls(args.chatId, () => runTurnInner(args))
    return { ...value, toolCalls: calls }
}

async function runTurnInner(args: {
    chatId: string
    userMessage: string
    history: ModelMessage[]
    llmConfig: LLMConfig
}): Promise<Omit<ScenarioTurnResult, 'toolCalls'>> {
    const { chatId, userMessage, history, llmConfig } = args

    if (llmConfig.provider === 'anthropic') {
        return runViaClaude(args)
    }
    if (llmConfig.provider !== 'openai' && llmConfig.provider !== 'custom') {
        throw new Error(`Provider "${llmConfig.provider}" isn't supported by the scenario collaborator yet.`)
    }

    const provider = createOpenAICompatible({
        name: 'openai-compatible',
        baseURL: normalizeBaseURL(llmConfig.endpoint),
        apiKey: llmConfig.apiKey || undefined,
        transformRequestBody: (body) => ({ ...body, ...(llmConfig.values ?? {}) }),
    })

    const messages: ModelMessage[] = [...history, { role: 'user', content: userMessage }]
    const result = await generateText({
        model: provider.chatModel(llmConfig.model),
        system: effectiveSystemPrompt(),
        messages,
        tools: buildTools(chatId),
        stopWhen: stepCountIs(MAX_STEPS),
    })

    return {
        reply: result.text,
        transcript: [...messages, ...result.response.messages],
    }
}

const AGENT_PORT = Number(process.env.AGENT_PORT ?? 8076)

async function runViaClaude(args: {
    chatId: string
    userMessage: string
    history: ModelMessage[]
    llmConfig: LLMConfig
}): Promise<Omit<ScenarioTurnResult, 'toolCalls'>> {
    const { chatId, userMessage, history, llmConfig } = args
    const response = await fetch(`http://127.0.0.1:${AGENT_PORT}/scenario-prompt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            chatId,
            userMessage,
            systemPrompt: effectiveSystemPrompt(),
            model: llmConfig.model || 'claude-sonnet-4-6',
            history: history.map(m => ({ role: m.role, content: typeof m.content === 'string' ? m.content : '' })),
        }),
    }).catch((err) => {
        throw new Error(`Scenario agent unreachable: ${err instanceof Error ? err.message : String(err)}`)
    })

    const body = await response.json() as { ok: boolean; reply?: string; error?: string }
    if (!body.ok) throw new Error(body.error ?? 'scenario agent failed')

    log.server.info(`Scenario collaborator replied for ${chatId}`)
    return {
        reply: body.reply ?? '',
        transcript: [...history, { role: 'user', content: userMessage }, { role: 'assistant', content: body.reply ?? '' }],
    }
}

export function activeLlmConfig(): LLMConfig {
    const id = state.userPreferences.activeLLMConfigId
    const cfg = id ? state.assets.llmConfigs[id] : null
    if (!cfg) throw new Error('No model selected — choose one in Preferences first.')
    return cfg
}
