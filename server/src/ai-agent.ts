import { generateText, hasToolCall, jsonSchema, stepCountIs, tool, type ModelMessage, type Tool } from 'ai'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { z } from 'zod'
import { COMMANDS, commandSchema, type CommandName } from '@shared/game-state/commands'
import { QUERIES, type QueryName } from '@shared/game-state/queries'
import type { LLMConfig } from '@shared/types'
import { execCommand, runQuery } from './agent'
import { db } from './db'
import { log } from './logger'

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

export async function saveAiTranscript(chatId: string, transcript: ModelMessage[]): Promise<void> {
    await db.updateTable('chats').set({ ai_transcript: JSON.stringify(transcript) }).where('id', '=', chatId).execute()
}

const MAX_STEPS = 64

function normalizeBaseURL(endpoint: string): string {
    return endpoint.replace(/\/+$/, '').replace(/\/chat\/completions$/, '')
}

function buildModel(cfg: LLMConfig) {
    const provider = createOpenAICompatible({
        name: 'openai-compatible',
        baseURL: normalizeBaseURL(cfg.endpoint),
        apiKey: cfg.apiKey || undefined,
        transformRequestBody: (body) => ({
            ...body,
            ...(cfg.values ?? {}),
            parallel_tool_calls: false,
        }),
    })
    return provider.chatModel(cfg.model)
}

class ToolFailure extends Error {
    constructor(reason: string) {
        super(reason)
        this.name = 'ToolFailure'
    }
}

export function buildAiSdkTools(
    chatId: string,
    enableChoicePrompts: boolean,
    enableSceneImages = false,
    enableItemIcons = false,
): Record<string, Tool> {
    const tools: Record<string, Tool> = {}

    for (const [key, spec] of Object.entries(COMMANDS)) {
        if (key === 'choice_prompt') continue
        if (key === 'generate_image' && !enableSceneImages) continue
        tools[spec.name] = tool({
            description: spec.description,
            inputSchema: jsonSchema(z.toJSONSchema(
                commandSchema(key as CommandName, { itemIcons: enableItemIcons }),
            )),
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
    userContent: string
    llmConfig: LLMConfig
    transcript: ModelMessage[]
    enableChoicePrompts: boolean
    enableSceneImages: boolean
    enableItemIcons: boolean
    signal: AbortSignal
}

export async function runAiSdkTurn(args: AiSdkTurnArgs): Promise<{ transcript: ModelMessage[] }> {
    const tools = buildAiSdkTools(args.chatId, args.enableChoicePrompts, args.enableSceneImages, args.enableItemIcons)
    const messages: ModelMessage[] = [...args.transcript, { role: 'user', content: args.userContent }]

    const result = await generateText({
        model: buildModel(args.llmConfig),
        system: args.systemPrompt,
        messages,
        tools,
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
