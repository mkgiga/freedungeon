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
            { path: ['max_tokens'], label: 'Max Tokens', default: 4096, control: { type: 'number', min: 1, max: 128000 } },
            { path: ['top_p'], label: 'Top P', default: 1, control: { type: 'slider', min: 0, max: 1, step: 0.01 } },
            { path: ['frequency_penalty'], label: 'Frequency Penalty', default: 0, control: { type: 'slider', min: -2, max: 2, step: 0.1 } },
            { path: ['presence_penalty'], label: 'Presence Penalty', default: 0, control: { type: 'slider', min: -2, max: 2, step: 0.1 } },
            { path: ['stop'], label: 'Stop Sequences', default: [], control: { type: 'tags', maxItems: 4 } },
        ],
    },
    'anthropic-claude': {
        name: 'Anthropic Claude',
        provider: 'anthropic',
        endpoint: 'https://api.anthropic.com/v1/messages',
        model: 'claude-sonnet-4-20250514',
        editable: false,
        apiKeyLocation: { type: 'header', header: 'x-api-key' },
        schema: [
            { path: ['temperature'], label: 'Temperature', default: 1, control: { type: 'slider', min: 0, max: 1, step: 0.01 } },
            { path: ['max_tokens'], label: 'Max Tokens', default: 4096, control: { type: 'number', min: 1, max: 200000 } },
            { path: ['top_p'], label: 'Top P', default: 1, control: { type: 'slider', min: 0, max: 1, step: 0.01 } },
            { path: ['top_k'], label: 'Top K', default: 0, control: { type: 'number', min: 0, max: 500 } },
            { path: ['stop_sequences'], label: 'Stop Sequences', default: [], control: { type: 'tags' } },
        ],
    },
    'gemini-2.5-pro': {
        name: 'Google Gemini 2.5 Pro',
        provider: 'google',
        endpoint: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent',
        model: 'gemini-2.5-pro',
        editable: false,
        apiKeyLocation: { type: 'query', param: 'key' },
        schema: [
            {
                path: ['generationConfig'],
                label: 'Generation Config',
                default: {},
                control: {
                    type: 'group',
                    fields: [
                        { path: ['generationConfig', 'temperature'], label: 'Temperature', default: 1, control: { type: 'slider', min: 0, max: 2, step: 0.01 } },
                        { path: ['generationConfig', 'maxOutputTokens'], label: 'Max Output Tokens', default: 8192, control: { type: 'number', min: 1, max: 1048576 } },
                        { path: ['generationConfig', 'topP'], label: 'Top P', default: 0.95, control: { type: 'slider', min: 0, max: 1, step: 0.01 } },
                        { path: ['generationConfig', 'topK'], label: 'Top K', default: 40, control: { type: 'number', min: 0 } },
                        { path: ['generationConfig', 'candidateCount'], label: 'Candidate Count', default: 1, control: { type: 'number', min: 1, max: 8 } },
                        { path: ['generationConfig', 'stopSequences'], label: 'Stop Sequences', default: [], control: { type: 'tags', maxItems: 5 } },
                    ],
                },
            },
            {
                path: ['safetySettings'],
                label: 'Safety Settings',
                default: [
                    { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_ONLY_HIGH' },
                    { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_ONLY_HIGH' },
                    { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_ONLY_HIGH' },
                    { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_ONLY_HIGH' },
                    { category: 'HARM_CATEGORY_CIVIC_INTEGRITY', threshold: 'BLOCK_ONLY_HIGH' },
                ],
                control: {
                    type: 'array',
                    item: {
                        path: [],
                        label: 'Safety Setting',
                        default: { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_ONLY_HIGH' },
                        control: {
                            type: 'group',
                            fields: [
                                {
                                    path: ['category'],
                                    label: 'Category',
                                    default: 'HARM_CATEGORY_HATE_SPEECH',
                                    control: {
                                        type: 'select',
                                        options: [
                                            { label: 'Hate Speech', value: 'HARM_CATEGORY_HATE_SPEECH' },
                                            { label: 'Harassment', value: 'HARM_CATEGORY_HARASSMENT' },
                                            { label: 'Sexually Explicit', value: 'HARM_CATEGORY_SEXUALLY_EXPLICIT' },
                                            { label: 'Dangerous Content', value: 'HARM_CATEGORY_DANGEROUS_CONTENT' },
                                            { label: 'Civic Integrity', value: 'HARM_CATEGORY_CIVIC_INTEGRITY' },
                                        ],
                                    },
                                },
                                {
                                    path: ['threshold'],
                                    label: 'Threshold',
                                    default: 'BLOCK_ONLY_HIGH',
                                    control: {
                                        type: 'select',
                                        options: [
                                            { label: 'Off', value: 'OFF' },
                                            { label: 'Block None', value: 'BLOCK_NONE' },
                                            { label: 'Block Only High', value: 'BLOCK_ONLY_HIGH' },
                                            { label: 'Block Medium and Above', value: 'BLOCK_MEDIUM_AND_ABOVE' },
                                            { label: 'Block Low and Above', value: 'BLOCK_LOW_AND_ABOVE' },
                                        ],
                                    },
                                },
                            ],
                        },
                    },
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
            { path: ['max_tokens'], label: 'Max Tokens', default: 4096, control: { type: 'number', min: 1 } },
            { path: ['top_p'], label: 'Top P', default: 1, control: { type: 'slider', min: 0, max: 1, step: 0.01 } },
        ],
    },
}

/** Build default values from a schema */
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
