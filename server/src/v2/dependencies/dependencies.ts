import { z } from 'zod'
import { router, procedure } from '../../trpc'
import { ensureDependency, dismissDependency, verifyDependency } from '../../dependencies'

const key = z.object({ key: z.enum(['claudeCli', 'rmbgModel']) })

export const dependenciesRouter = router({
    /** Start (or join) a download. Resolves when it settles; progress arrives
     *  over the socket, so the client doesn't need this promise's result. */
    ensure: procedure
        .input(key)
        .mutation(async ({ input }) => {
            await ensureDependency(input.key)
            return { success: true }
        }),

    /** Give up on a failed download and unblock the UI. */
    dismiss: procedure
        .input(key)
        .mutation(async ({ input }) => {
            await dismissDependency(input.key)
            return { success: true }
        }),

    /** Re-check against disk — for a file deleted or replaced behind our back. */
    verify: procedure
        .input(key)
        .mutation(async ({ input }) => {
            return { status: await verifyDependency(input.key) }
        }),
})
