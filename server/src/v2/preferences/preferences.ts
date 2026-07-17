import { z } from 'zod'
import { router, procedure } from '../../trpc'
import { state, setState } from '../../server'

export const preferencesRouter = router({
    get: procedure
        .query(() => {
            return state.userPreferences
        }),

    update: procedure
        .input(z.object({
            activeLLMConfigId: z.string().nullable().optional(),
            playerCharacterId: z.string().nullable().optional(),
            enableChoicePrompts: z.boolean().optional(),
            debug: z.boolean().optional(),
        }).loose())
        .mutation(({ input }) => {
            for (const [key, value] of Object.entries(input)) {
                if (value !== undefined) {
                    setState('userPreferences', key, value)
                }
            }
            return state.userPreferences
        }),

    setFeature: procedure
        .input(z.object({
            key: z.string(),
            enabled: z.boolean().optional(),
            values: z.record(z.string(), z.any()).optional(),
        }))
        .mutation(({ input }) => {
            const features = state.userPreferences.features ?? {}
            const prev = features[input.key] ?? { enabled: false, values: {} }
            const next = {
                enabled: input.enabled ?? prev.enabled,
                values: input.values ? { ...prev.values, ...input.values } : prev.values,
            }
            // `features` is initialized to {} in initial state, so this nested
            // path set is safe and emits a granular reactive update.
            setState('userPreferences', 'features', input.key, next)
            return state.userPreferences.features?.[input.key]
        }),
})
