import { z } from 'zod'
import { router, procedure } from '../../trpc'
import { mutate, state } from '../../server'
import { ensureDependency, isSatisfied } from '../../dependencies'
import { DEPENDENCIES } from '@shared/dependencies'

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
                    mutate(s => { s.userPreferences[key] = value })
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
        .mutation(async ({ input }) => {
            const features = state.userPreferences.features ?? {}
            const prev = features[input.key] ?? { enabled: false, values: {} }
            const next = {
                enabled: input.enabled ?? prev.enabled,
                values: input.values ? { ...prev.values, ...input.values } : prev.values,
            }

            // Background removal needs its weights on disk before it can run.
            // Fetch them at the moment the user opts in, rather than stalling a
            // turn later — the patcher renders the progress.
            const wantsBgRemoval = next.enabled && next.values.removeIconBackground === true
            const hadBgRemoval = prev.enabled && prev.values.removeIconBackground === true
            if (input.key === 'imageGen' && wantsBgRemoval && !hadBgRemoval) {
                await ensureDependency('rmbgModel')
                if (!(await isSatisfied('rmbgModel'))) {
                    throw new Error(
                        `${DEPENDENCIES.rmbgModel.label} could not be downloaded, so background removal can't be enabled.`,
                    )
                }
            }
            // `features` is initialized to {} in initial state, so this nested
            // path set is safe and emits a granular reactive update.
            mutate(s => { s.userPreferences.features![input.key] = next })
            return state.userPreferences.features?.[input.key]
        }),
})
