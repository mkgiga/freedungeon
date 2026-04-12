import { createSignal, createRoot, createEffect } from "solid-js"
import { state, setState } from "./server"
import type { LLMConfig, LLMProvider } from "@shared/types"
import type { SchemaField } from "@shared/schema-ui"
import { LLM_PRESETS, type ApiKeyLocation } from "@shared/llm-presets"

// ── Schema → Body serialization ──

function getByPath(obj: any, path: string[]): any {
    let current = obj
    for (const key of path) {
        if (current == null) return undefined
        current = current[key]
    }
    return current
}

function setByPath(obj: any, path: string[], value: any): any {
    if (path.length === 0) return value
    const result = Array.isArray(obj) ? [...obj] : { ...obj }
    const head = path[0]!
    const rest = path.slice(1)
    result[head] = rest.length === 0 ? value : setByPath(result[head] ?? {}, rest, value)
    return result
}

function buildRequestBody(fields: SchemaField[], values: Record<string, any>): Record<string, any> {
    let body: Record<string, any> = {}
    for (const field of fields) {
        const value = getByPath(values, field.path)
        if (value !== undefined) {
            body = setByPath(body, field.path, value)
        }
    }
    return body
}

// ── API Key handling ──

function resolveApiKeyLocation(config: LLMConfig): ApiKeyLocation {
    const preset = Object.values(LLM_PRESETS).find(p => p.provider === config.provider)
    return preset?.apiKeyLocation ?? { type: 'header', header: 'Authorization', prefix: 'Bearer ' }
}

function applyApiKey(url: URL, headers: Record<string, string>, config: LLMConfig) {
    const location = resolveApiKeyLocation(config)
    if (!config.apiKey) return

    if (location.type === 'query') {
        url.searchParams.set(location.param, config.apiKey)
    } else {
        headers[location.header] = (location.prefix ?? '') + config.apiKey
    }
}

// ── System prompt injection per provider ──

type Message = { role: string; content: string }

function buildMessages(
    provider: LLMProvider,
    history: Message[],
    systemPrompt?: string
): { messages?: any[]; contents?: any[]; systemInstruction?: any; system?: string } {

    switch (provider) {
        case 'google': {
            // Gemini native: contents[] + systemInstruction
            const contents = history.map(m => ({
                role: m.role === 'assistant' ? 'model' : 'user',
                parts: [{ text: m.content }],
            }))
            return {
                contents,
                ...(systemPrompt ? { systemInstruction: { parts: [{ text: systemPrompt }] } } : {}),
            }
        }

        case 'anthropic': {
            // Anthropic: messages[] (no system role) + top-level system field
            const messages = history
                .filter(m => m.role !== 'system')
                .map(m => ({
                    role: m.role,
                    content: m.content,
                }))
            return {
                messages,
                ...(systemPrompt ? { system: systemPrompt } : {}),
            }
        }

        case 'openai':
        case 'custom':
        default: {
            // OpenAI v1: system prompt as first message
            const messages: Message[] = []
            if (systemPrompt) {
                messages.push({ role: 'system', content: systemPrompt })
            }
            messages.push(...history.filter(m => m.role !== 'system'))
            return { messages }
        }
    }
}

// ── Response parsing per provider ──

function parseResponse(provider: LLMProvider, data: any): string {
    switch (provider) {
        case 'google':
            return data?.candidates?.[0]?.content?.parts?.[0]?.text ?? ''
        case 'anthropic':
            return data?.content?.[0]?.text ?? ''
        case 'openai':
        case 'custom':
        default:
            return data?.choices?.[0]?.message?.content ?? ''
    }
}

// ── Chat Completion Manager ──

export class ChatCompletionManager {
    private static _abortController = createSignal<AbortController | null>(null)

    static get abortController(): AbortController | null {
        return this._abortController[0]()
    }
    static set abortController(v: AbortController | null) {
        this._abortController[1](v)
    }

    static get isGenerating() {
        return this.abortController !== null
    }

    static get currentLLMConfig() {
        const id = state.userPreferences.activeLLMConfigId
        if (id === null) return null
        return state.assets.llmConfigs[id] ?? null
    }

    static cancel() {
        this.abortController?.abort()
        this.abortController = null
    }

    static async chatCompletion({ history, systemPrompt, onComplete, onError }: {
        history: { role: 'user' | 'assistant' | 'system'; content: string }[]
        systemPrompt?: string
        onComplete: (response: string) => void
        onError?: (error: Error) => void
    }) {
        let fetchResult;

        if (this.isGenerating) {
            onError?.(new Error('Already generating a response'))
            return
        }

        const config = this.currentLLMConfig
        if (!config) {
            onError?.(new Error('No active LLM config'))
            return
        }

        this.abortController = new AbortController()

        try {
            const url = new URL(config.endpoint)
            const headers: Record<string, string> = {
                'Content-Type': 'application/json',
            }

            // Apply API key
            applyApiKey(url, headers, config)

            // Build provider-specific messages/system prompt
            const messagePayload = buildMessages(config.provider, history, systemPrompt)

            // Build params from schema + user values
            const schemaParams = buildRequestBody(config.schema, config.values)

            // Assemble request body
            const body: Record<string, any> = {
                ...schemaParams,
                ...messagePayload,
                model: config.model,
            }

            // Anthropic needs extra headers
            if (config.provider === 'anthropic') {
                headers['anthropic-version'] = '2023-06-01'
            }

            // Google native doesn't send model in body (it's in the URL)
            if (config.provider === 'google') {
                delete body.model
            }

            const response = await fetch(url.toString(), {
                method: 'POST',
                headers,
                body: JSON.stringify(body),
                signal: this.abortController.signal,
            })


            if (!response.ok) {
                const errorText = await response.text()
                throw new Error(`${response.status}: ${errorText}`)
            }

            const data = await response.json()
            fetchResult = structuredClone(data) // For debugging after aborting
            const text = parseResponse(config.provider, data)
            onComplete(text)

        } catch (error: any) {
            if (error.name === 'AbortError') {
                // Cancelled — not an error
                return
            }
            onError?.(error instanceof Error ? error : new Error(String(error)))
        } finally {
            this.abortController = null
        }

        return fetchResult; // For debugging purposes, not used in normal flow
    }
}

/**
 * Sync `ChatCompletionManager.isGenerating` (signal-backed) into
 * `state.currentChat.isGenerating`. Called once at server startup from
 * `server.ts#start()` so the client sees a real-time generating flag.
 */
export function bootstrapGenerationSync() {
    createRoot(() => {
        createEffect(() => {
            setState('isGenerating', ChatCompletionManager.isGenerating)
        })
    })
}
