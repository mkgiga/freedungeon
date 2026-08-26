import type { SchemaField } from './schema-ui'
import type { LLMProvider } from './types'

export type ApiKeyLocation = {
    type: 'header'
    header: string
    prefix?: string
} | {
    type: 'query'
    param: string
}

export type LLMPreset = {
    name: string
    provider: LLMProvider
    endpoint: string
    model: string
    schema: SchemaField[]
    editable: boolean
    apiKeyLocation: ApiKeyLocation
}

export const LLM_PRESETS: Record<string, LLMPreset> = {
    'openai-gpt4o': {
        name: 'OpenAI GPT-4o',
        provider: 'openai',
        endpoint: 'https://api.openai.com/v1/chat/completions',
        model: 'gpt-4o',
        editable: false,
        apiKeyLocation: { type: 'header', header: 'Authorization', prefix: 'Bearer ' },
        schema: [
            { path: ['temperature'], label: 'Temperature', default: 1, control: { type: 'slider', min: 0, max: 2, step: 0.01 } },
            { path: ['max_tokens'], label: 'Max Tokens', default: 8192, control: { type: 'number', min: 1, max: 128000 } },
            { path: ['top_p'], label: 'Top P', default: 1, control: { type: 'slider', min: 0, max: 1, step: 0.01 } },
            { path: ['frequency_penalty'], label: 'Frequency Penalty', default: 0, control: { type: 'slider', min: -2, max: 2, step: 0.1 } },
            { path: ['presence_penalty'], label: 'Presence Penalty', default: 0, control: { type: 'slider', min: -2, max: 2, step: 0.1 } },
            { path: ['stop'], label: 'Stop Sequences', default: [], control: { type: 'tags', maxItems: 4 } },
        ],
    },
    'anthropic-claude': {
        name: 'Claude Opus 4.7',
        provider: 'anthropic',
        endpoint: 'https://api.anthropic.com/v1/messages',
        model: 'claude-opus-4-7',
        editable: false,
        apiKeyLocation: { type: 'header', header: 'x-api-key' },
        schema: [
            { path: ['temperature'], label: 'Temperature', default: 1, control: { type: 'slider', min: 0, max: 2, step: 0.01 } },
            { path: ['max_tokens'], label: 'Max Tokens', default: 256000, control: { type: 'number', min: 1, max: 1000000 } },
            { path: ['top_p'], label: 'Top P', default: 1, control: { type: 'slider', min: 0, max: 1, step: 0.01 } },
            { path: ['top_k'], label: 'Top K', default: 0, control: { type: 'number', min: 0, max: 500 } },
            { path: ['stop_sequences'], label: 'Stop Sequences', default: [], control: { type: 'tags' } },
        ],
    },
    'deepseek-v4': {
        name: 'DeepSeek V4',
        provider: 'deepseek',
        endpoint: 'https://api.deepseek.com/chat/completions',
        model: 'deepseek-v4-pro',
        editable: false,
        apiKeyLocation: { type: 'header', header: 'Authorization', prefix: 'Bearer ' },
        schema: [
            {
                path: ['temperature'],
                label: 'Temperature',
                description: 'Ignored while thinking is enabled.',
                default: 1,
                control: { type: 'slider', min: 0, max: 2, step: 0.01 },
            },
            { path: ['max_tokens'], label: 'Max Tokens', default: 8192, control: { type: 'number', min: 1 } },
            { path: ['top_p'], label: 'Top P', default: 1, control: { type: 'slider', min: 0, max: 1, step: 0.01 } },
            {
                // Under providerOptions, not the body - the AI SDK provider takes
                // it as configuration rather than passing it through.
                //
                // Off because the agent loop sends tool_choice "required", which
                // thinking mode rejects outright with a 400. Measured against the
                // live API: "required" 400s every time while thinking is on, and
                // falling back to "auto" leaves ~1 turn in 8 with no tool call at
                // all, which renders as nothing happening.
                path: ['providerOptions', 'deepseek', 'thinking', 'type'],
                label: 'Thinking mode',
                description: 'Off: DeepSeek rejects the forced tool calls this app relies on while thinking is on.',
                default: 'disabled',
                control: {
                    type: 'select',
                    options: [
                        { label: 'Disabled', value: 'disabled' },
                        { label: 'Enabled (turns will fail)', value: 'enabled' },
                    ],
                },
            },
        ],
    },
    'openai-compatible': {
        name: 'OpenAI Compatible (Custom)',
        provider: 'custom',
        endpoint: 'http://localhost:5001/v1/chat/completions',
        model: '',
        editable: true,
        apiKeyLocation: { type: 'header', header: 'Authorization', prefix: 'Bearer ' },
        schema: [
            { path: ['temperature'], label: 'Temperature', default: 1, control: { type: 'slider', min: 0, max: 2, step: 0.01 } },
            { path: ['max_tokens'], label: 'Max Tokens', default: 8192, control: { type: 'number', min: 1 } },
            { path: ['top_p'], label: 'Top P', default: 1, control: { type: 'slider', min: 0, max: 1, step: 0.01 } },
        ],
    },
}

export function defaultValuesFromSchema(schema: SchemaField[]): Record<string, any> {
    const values: Record<string, any> = {}
    for (const field of schema) {
        if (field.path.length === 0) continue
        let target = values
        for (let i = 0; i < field.path.length - 1; i++) {
            const key = field.path[i]!
            target[key] = target[key] ?? {}
            target = target[key]
        }
        const lastKey = field.path[field.path.length - 1]!
        target[lastKey] = field.default
    }
    return values
}
