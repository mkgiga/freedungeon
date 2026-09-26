import { z } from 'zod'
import { router, procedure } from '../../trpc'
import { mutate, state } from '../../server'

export const preferencesRouter = router({
    get: procedure
        .query(() => {
            return state.userPreferences
        }),

    update: procedure
        .input(z.object({
            activeLLMConfigId: z.string().nullable().optional(),
            playerCharacterId: z.string().nullable().optional(),
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
})
