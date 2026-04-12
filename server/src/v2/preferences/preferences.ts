import { z } from 'zod'
import { router, procedure } from '../../trpc'
import { state, setState } from '../../server'
import { savePreferences } from '../../preferences'

export const preferencesRouter = router({
    get: procedure
        .query(() => {
            return state.userPreferences
        }),

    update: procedure
        .input(z.object({
            activeLLMConfigId: z.string().nullable().optional(),
            playerCharacterId: z.string().nullable().optional(),
        }).passthrough())
        .mutation(({ input }) => {
            for (const [key, value] of Object.entries(input)) {
                if (value !== undefined) {
                    setState('userPreferences', key, value)
                }
            }
            savePreferences(state.userPreferences)
            return state.userPreferences
        }),
})
