import { z } from 'zod'
import { router, procedure } from '../../trpc'
import { mutate, state } from '../../server'
import { ensureDependency, isSatisfied, planDependencies } from '../../dependencies'
import { requiredSdDependencies } from '../../sd/server'
import { getSdBuildChoice } from '../../sd/dependency'
import { cancelAgentTurn } from '../../agent'
import { notification } from '../../notifications'
import { DEPENDENCIES } from '@shared/dependencies'

export const preferencesRouter = router({
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

            const wantsImages = next.enabled
            const hadImages = prev.enabled
            if (input.key === 'imageGen' && wantsImages && !hadImages) {
                const choice = getSdBuildChoice()
                if (choice && !choice.supported) throw new Error(choice.message)

                if (state.isGenerating) {
                    await cancelAgentTurn()
                    notification({
                        title: 'Turn stopped',
                        content: 'Image generation was switched on, and its files are still downloading. '
                            + 'The current turn was stopped so it could not fail partway through.',
                        backgroundColor: '#7a5a1f',
                        textColor: '#fff',
                        show: true,
                        toast: true,
                        push: false,
                    })
                }

                for (const dep of requiredSdDependencies()) {
                    await ensureDependency(dep)
                    if (!(await isSatisfied(dep))) {
                        throw new Error(`${DEPENDENCIES[dep].label} could not be downloaded, so image generation can't be enabled.`)
                    }
                }
            }

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
            mutate(s => { s.userPreferences.features![input.key] = next })
            return state.userPreferences.features?.[input.key]
        }),
})
