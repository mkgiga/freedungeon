/**
 * Running one collaborator turn, on whichever provider the user has configured.
 *
 * The two paths differ only in how tools are presented to the model:
 *
 *  - OpenAI-compatible → the AI SDK loop, in-process, tools built here.
 *  - Anthropic         → the Claude subprocess, tools exposed as MCP over
 *                        /agent-rpc (kind: 'scenario').
 *
 * Both bottom out in `runScenarioTool`, so scoping and behaviour can't diverge
 * between providers — only the transport does.
 *
 * Unlike the roleplaying agent this produces no blocks, no game state and no
 * ChatMessage rows. The conversation is transient and lives in the panel.
 */

import { generateText, jsonSchema, stepCountIs, tool, type ModelMessage, type Tool } from 'ai'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { z } from 'zod'
import { SCENARIO_TOOLS, SCENARIO_AGENT_PROMPT, type ScenarioToolName } from '@shared/scenario-agent/tools'
import { runScenarioTool, recordingToolCalls, type ScenarioToolCall } from './scenario-agent'
import { state } from './server'
import { log } from './logger'
import type { LLMConfig } from '@shared/types'

const MAX_STEPS = 24

function normalizeBaseURL(endpoint: string): string {
    // Same treatment the roleplay loop applies: the AI SDK wants the /v1 root,
    // users paste the full chat-completions path.
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
    /** What the agent actually did, in order, for the panel to show. */
    toolCalls: ScenarioToolCall[]
}

/**
 * One exchange with the collaborator. `history` is the panel's conversation so
 * far; the caller owns it, since none of this is persisted.
 */
export async function runScenarioTurn(args: {
    chatId: string
    userMessage: string
    history: ModelMessage[]
    llmConfig: LLMConfig
}): Promise<ScenarioTurnResult> {
    // Wraps both providers: the recorder sits under `runScenarioTool`, which is
    // the one thing they share.
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
        // The Claude path runs in the agent subprocess; see scenarioRpcRouter.
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
        system: SCENARIO_AGENT_PROMPT,
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
    // The subprocess owns the SDK; it builds an MCP server over the same tool
    // registry and calls back into /agent-rpc to execute each one.
    const response = await fetch(`http://127.0.0.1:${AGENT_PORT}/scenario-prompt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            chatId,
            userMessage,
            systemPrompt: SCENARIO_AGENT_PROMPT,
            model: llmConfig.model || 'claude-sonnet-4-6',
            // Transcript is replayed as plain text: the collaborator's history is
            // short and toolless between turns, so there's no session to resume.
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

/** The config the collaborator runs on — the user's active one. */
export function activeLlmConfig(): LLMConfig {
    const id = state.userPreferences.activeLLMConfigId
    const cfg = id ? state.assets.llmConfigs[id] : null
    if (!cfg) throw new Error('No active LLM config — choose one in Preferences first.')
    return cfg
}
