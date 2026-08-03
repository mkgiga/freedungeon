import { z } from 'zod'
import { router, procedure } from '../../trpc'
import { state, setState, deleteState } from '../../server'
import { nanoid } from 'nanoid'
import { LLM_PRESETS, defaultValuesFromSchema } from '@shared/llm-presets'
import type { LLMConfig } from '@shared/types'
import { ensureDependency, isSatisfied } from '../../dependencies'
import { DEPENDENCIES } from '@shared/dependencies'
import { restartAgentProcess } from '../../agent'

/**
 * Block a config from being saved until whatever its provider needs is on disk
 * and verified. Only Anthropic has an external dependency today; the others are
 * plain HTTP and need nothing.
 */
async function requireProviderDependencies(provider: string): Promise<void> {
    if (provider !== 'anthropic') return
    const alreadyHad = await isSatisfied('claudeCli')
    await ensureDependency('claudeCli')
    if (!(await isSatisfied('claudeCli'))) {
        throw new Error(
            `${DEPENDENCIES.claudeCli.label} could not be downloaded, so this config can't be saved. ` +
            `Retry from the download panel, or use an OpenAI-compatible endpoint instead.`,
        )
    }
    // The agent process receives the CLI path at spawn time, so one started
    // before this download needs restarting to see it.
    if (!alreadyHad) await restartAgentProcess()
}

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
            systemPrompt: z.string().optional().default(''),
            schema: z.string(),
            values: z.string(),
        }))
        .mutation(async ({ input }) => {
            // An Anthropic config is useless without the CLI the agent drives,
            // so resolve that first and refuse to save if it can't be had. The
            // client renders the patcher off `state.dependencies` while this
            // awaits, then this either proceeds or throws.
            await requireProviderDependencies(input.provider)

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
                    systemPrompt: input.systemPrompt,
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
                systemPrompt: input.systemPrompt,
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
        .mutation(async ({ input }) => {
            const preset = LLM_PRESETS[input.presetKey]
            if (!preset) throw new Error(`Unknown preset: ${input.presetKey}`)

            await requireProviderDependencies(preset.provider)

            const now = Date.now()
            const newId = nanoid()
            const config: LLMConfig = {
                id: newId,
                name: preset.name,
                provider: preset.provider,
                endpoint: preset.endpoint,
                model: preset.model,
                apiKey: '',
                systemPrompt: '',
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
            return { success: true }
        }),
})
