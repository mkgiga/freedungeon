import { z } from 'zod'
import { router, procedure } from '../../trpc'
import { state, setState, deleteState } from '../../server'
import { deleteLLMConfig } from '../../db'
import { nanoid } from 'nanoid'
import { LLM_PRESETS, defaultValuesFromSchema } from '@shared/llm-presets'
import type { LLMConfig } from '@shared/types'

export const llmConfigsRouter = router({
    list: procedure
        .query(() => {
            return Object.values(state.assets.llmConfigs)
        }),

    get: procedure
        .input(z.object({ id: z.string() }))
        .query(({ input }) => {
            return state.assets.llmConfigs[input.id] ?? null
        }),

    upsert: procedure
        .input(z.object({
            id: z.string().optional(),
            name: z.string().min(1),
            provider: z.enum(['openai', 'anthropic', 'google', 'custom']),
            endpoint: z.string().min(1),
            model: z.string(),
            apiKey: z.string().optional().default(''),
            schema: z.string(),
            values: z.string(),
        }))
        .mutation(({ input }) => {
            const now = Date.now()
            const parsedSchema = JSON.parse(input.schema)
            const parsedValues = JSON.parse(input.values)

            if (input.id !== undefined && state.assets.llmConfigs[input.id]) {
                const id = input.id
                setState('assets', 'llmConfigs', id, {
                    ...state.assets.llmConfigs[id],
                    name: input.name,
                    provider: input.provider,
                    endpoint: input.endpoint,
                    model: input.model,
                    apiKey: input.apiKey,
                    schema: parsedSchema,
                    values: parsedValues,
                    updatedAt: now,
                })
                return state.assets.llmConfigs[id]
            }

            const newId = nanoid()
            const config: LLMConfig = {
                id: newId,
                name: input.name,
                provider: input.provider,
                endpoint: input.endpoint,
                model: input.model,
                apiKey: input.apiKey,
                schema: parsedSchema,
                values: parsedValues,
                createdAt: now,
                updatedAt: now,
            }
            setState('assets', 'llmConfigs', newId, config)
            return config
        }),

    createFromPreset: procedure
        .input(z.object({ presetKey: z.string() }))
        .mutation(({ input }) => {
            const preset = LLM_PRESETS[input.presetKey]
            if (!preset) throw new Error(`Unknown preset: ${input.presetKey}`)

            const now = Date.now()
            const newId = nanoid()
            const config: LLMConfig = {
                id: newId,
                name: preset.name,
                provider: preset.provider,
                endpoint: preset.endpoint,
                model: preset.model,
                apiKey: '',
                schema: preset.schema,
                values: defaultValuesFromSchema(preset.schema),
                createdAt: now,
                updatedAt: now,
            }
            setState('assets', 'llmConfigs', newId, config)
            return config
        }),

    delete: procedure
        .input(z.object({ id: z.string() }))
        .mutation(({ input }) => {
            deleteState('assets', 'llmConfigs', input.id)
            deleteLLMConfig(input.id)
            return { success: true }
        }),
})
