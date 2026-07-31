/**
 * In-server agentic loop for OpenAI-v1-compatible providers (llama.cpp, vLLM,
 * Ollama, LM Studio, KoboldCpp, LocalAI, …). The Anthropic path runs in the
 * `agent-claude` subprocess because the Claude Agent SDK is a heavyweight
 * runtime; OpenAI-v1 is plain HTTP, so this loop runs in-process via the Vercel
 * AI SDK (`ai` v6) and reuses the same tool execution path as the Claude path
 * (`execCommand`/`runQuery` in agent.ts → one Block → one ChatMessage).
 *
 * Grounded against installed types (ai@6, @ai-sdk/openai-compatible@2):
 *  - generateText stopWhen DEFAULTS to stepCountIs(1) in v6 — must set it to loop.
 *  - one tool call per step: toolChoice:'required' + parallel_tool_calls:false
 *    injected via the provider's transformRequestBody (no top-level option exists).
 *  - structured history: append result.response.messages to the transcript.
 */
import { generateText, hasToolCall, jsonSchema, stepCountIs, tool, type ModelMessage, type Tool } from 'ai'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { z } from 'zod'
import { COMMANDS, type CommandName } from '@shared/game-state/commands'
import { QUERIES, type QueryName } from '@shared/game-state/queries'
import type { LLMConfig } from '@shared/types'
import { execCommand, runQuery } from './agent'
import { db } from './db'
import { log } from './logger'

/** Load a chat's persisted OpenAI-v1 transcript (model memory). Empty if none. */
export async function loadAiTranscript(chatId: string): Promise<ModelMessage[]> {
    const row = await db.selectFrom('chats').select('ai_transcript').where('id', '=', chatId).executeTakeFirst()
    if (!row?.ai_transcript) return []
    try {
        return JSON.parse(row.ai_transcript) as ModelMessage[]
    } catch {
        log.server.warn(`Corrupt ai_transcript for chat ${chatId}; starting fresh`)
        return []
    }
}

/** Persist a chat's OpenAI-v1 transcript. */
export async function saveAiTranscript(chatId: string, transcript: ModelMessage[]): Promise<void> {
    await db.updateTable('chats').set({ ai_transcript: JSON.stringify(transcript) }).where('id', '=', chatId).execute()
}

/** Safety cap on tool-call steps per turn (the model normally stops via end_turn). */
const MAX_STEPS = 64

/**
 * `LLMConfig.endpoint` is stored as a full chat-completions URL (e.g.
 * `http://127.0.0.1:8080/v1/chat/completions`), but the AI SDK provider wants
 * the API root (`…/v1`) and appends `/chat/completions` itself.
 */
function normalizeBaseURL(endpoint: string): string {
    return endpoint.replace(/\/+$/, '').replace(/\/chat\/completions$/, '')
}

function buildModel(cfg: LLMConfig) {
    const provider = createOpenAICompatible({
        name: 'openai-compatible',
        baseURL: normalizeBaseURL(cfg.endpoint),
        apiKey: cfg.apiKey || undefined,
        // No native `parallel_tool_calls` option on the compatible provider, so
        // inject it into the request body here. Also merge the user's configured
        // params (temperature, top_p, max_tokens, top_k, …) straight through —
        // local servers accept these snake_case body fields.
        transformRequestBody: (body) => ({
            ...body,
            ...(cfg.values ?? {}),
            parallel_tool_calls: false,
        }),
    })
    return provider.chatModel(cfg.model)
}

/**
 * A tool call rejected by our own validation (bad args, failed `validate`,
 * chat mismatch). Thrown rather than returned so the AI SDK records a
 * `tool-error` part instead of a successful result — the loop is unaffected
 * (the SDK catches executor throws and feeds the error back as the tool's
 * output), and it mirrors the `isError: true` the Claude MCP path already
 * sets in agent-claude/src/mcp.ts. The message carries execCommand's reason
 * prefix (`invalid_action: ...`) so the model is told what to do next.
 */
class ToolFailure extends Error {
    constructor(reason: string) {
        super(reason)
        this.name = 'ToolFailure'
    }
}

/**
 * Build the AI SDK tool set from the shared registries. Every tool's `execute`
 * routes through `execCommand`/`runQuery` — the identical execution path the
 * Claude MCP server uses — so a tool call produces one Block + one ChatMessage
 * and returns the effect/result text the model sees next step.
 */
export function buildAiSdkTools(chatId: string, enableChoicePrompts: boolean, enableSceneImages = false): Record<string, Tool> {
    const tools: Record<string, Tool> = {}

    for (const [key, spec] of Object.entries(COMMANDS)) {
        if (key === 'choice_prompt') continue // internal block-builder, invoked by end_turn
        if (key === 'generate_image' && !enableSceneImages) continue // gated on the imageGen sub-toggle
        tools[spec.name] = tool({
            description: spec.description,
            inputSchema: jsonSchema(z.toJSONSchema(spec.schema)),
            execute: async (args) => {
                const r = await execCommand(chatId, key as CommandName, args as Record<string, unknown>)
                if ('error' in r) throw new ToolFailure(r.error ?? 'unknown error')
                return r.effects
            },
        })
    }

    for (const [key, spec] of Object.entries(QUERIES)) {
        tools[spec.name] = tool({
            description: spec.description,
            inputSchema: jsonSchema(z.toJSONSchema(spec.schema)),
            execute: async (args) => {
                const r = runQuery(chatId, key as QueryName, args as Record<string, unknown>)
                if ('error' in r) throw new ToolFailure(r.error ?? 'unknown error')
                return r.result
            },
        })
    }

    // Turn terminator. Mirrors agent-claude/src/mcp.ts: optional `choices` when
    // the feature is on. The loop stops on `hasToolCall('end_turn')`.
    const endTurnBase = 'Call this when the causal chain initiated by the user\'s prompt is fully resolved and you have nothing more to do. After end_turn, control returns to the user.'
    tools['end_turn'] = tool({
        description: enableChoicePrompts
            ? `${endTurnBase} You may optionally pass \`choices\`: 2+ candidate next actions for the focus actor at this branch point.`
            : endTurnBase,
        inputSchema: jsonSchema(z.toJSONSchema(enableChoicePrompts
            ? z.object({ choices: z.array(z.string()).min(2).optional().describe('2+ candidate next actions for the focus actor, present tense.') })
            : z.object({}))),
        execute: async (args) => {
            const choices = enableChoicePrompts ? (args as { choices?: string[] }).choices : undefined
            if (choices && choices.length > 0) await execCommand(chatId, 'choice_prompt' as CommandName, { options: choices })
            return 'Turn ended.'
        },
    })

    return tools
}

export type AiSdkTurnArgs = {
    chatId: string
    systemPrompt: string
    /** The user turn content (already wrapped with any <system_notice>). */
    userContent: string
    llmConfig: LLMConfig
    /** Prior structured conversation (model memory). Empty for a fresh chat. */
    transcript: ModelMessage[]
    enableChoicePrompts: boolean
    enableSceneImages: boolean
    signal: AbortSignal
}

/**
 * Run one OpenAI-v1 agentic turn. Tools execute in-process (producing
 * ChatMessages live as the loop runs), and the structured transcript is
 * extended with this turn's assistant/tool messages so the next turn resumes
 * with full memory of its atomic tool calls + results.
 */
export async function runAiSdkTurn(args: AiSdkTurnArgs): Promise<{ transcript: ModelMessage[] }> {
    const tools = buildAiSdkTools(args.chatId, args.enableChoicePrompts, args.enableSceneImages)
    const messages: ModelMessage[] = [...args.transcript, { role: 'user', content: args.userContent }]

    const result = await generateText({
        model: buildModel(args.llmConfig),
        system: args.systemPrompt,
        messages,
        tools,
        // One tool call per step (mutable state + better reasoning): force a tool
        // every step, loop until end_turn (or the safety cap).
        toolChoice: 'required',
        stopWhen: [hasToolCall('end_turn'), stepCountIs(MAX_STEPS)],
        abortSignal: args.signal,
        onStepFinish: (step) => {
            if (step.toolCalls.length > 1) {
                log.server.warn(`AI SDK turn: provider returned ${step.toolCalls.length} tool calls in one step (expected 1) — server ignored parallel_tool_calls:false`)
            }
        },
    })

    return { transcript: [...messages, ...result.response.messages] }
}
