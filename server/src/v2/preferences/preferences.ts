import { z } from 'zod'
import { router, procedure } from '../../trpc'
import { mutate, state } from '../../server'
import { ensureDependency, isSatisfied, planDependencies } from '../../dependencies'
import { requiredSdDependencies } from '../../sd/server'
import { getSdBuildChoice } from '../../sd/dependency'
import { DEPENDENCIES } from '@shared/dependencies'

export const preferencesRouter = router({
    /**
     * Whether this machine can generate images, and what enabling it downloads.
     *
     * Both answers live server-side because both depend on hardware the client
     * cannot see: which GPU is present decides the backend, and the backend
     * decides whether a CUDA runtime is part of the bill.
     *
     * An empty `items` with `supported: true` means everything is already on
     * disk and the toggle can simply be flipped.
     */
    imageGenPlan: procedure.query(async () => {
        const choice = getSdBuildChoice()
        if (choice && !choice.supported) {
            return { supported: false as const, title: choice.title, message: choice.message, items: [] }
        }
        return { supported: true as const, items: await planDependencies(requiredSdDependencies()) }
    }),

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

            // Same rule as background removal below, for a much larger payload:
            // fetch the image generator the moment the user opts in, so the
            // patcher shows the ~3GB arriving instead of a turn hanging later.
            // The client has already shown the plan and been told yes — this is
            // where that answer is acted on.
            const wantsImages = next.enabled
            const hadImages = prev.enabled
            if (input.key === 'imageGen' && wantsImages && !hadImages) {
                const choice = getSdBuildChoice()
                if (choice && !choice.supported) throw new Error(choice.message)
                for (const dep of requiredSdDependencies()) {
                    await ensureDependency(dep)
                    if (!(await isSatisfied(dep))) {
                        throw new Error(`${DEPENDENCIES[dep].label} could not be downloaded, so image generation can't be enabled.`)
                    }
                }
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
