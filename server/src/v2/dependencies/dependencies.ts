import { z } from 'zod'
import { router, procedure } from '../../trpc'
import {
    ensureDependency,
    dismissDependency,
    verifyDependency,
    beginClaudeSignIn,
    submitAuthCode,
    cancelClaudeSignIn,
} from '../../dependencies'
import { DEPENDENCIES, type DependencyKey } from '@shared/dependencies'

// Derived from the registry rather than restated, so adding a dependency can't
// leave an endpoint that refuses to accept it.
const key = z.object({
    key: z.enum(Object.keys(DEPENDENCIES) as [DependencyKey, ...DependencyKey[]]),
})

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

    /** Kick off the Claude CLI's OAuth flow; the URL arrives over the socket. */
    signIn: procedure
        .mutation(async () => {
            await beginClaudeSignIn()
            return { success: true }
        }),

    /** Hand the CLI the code the browser showed, when it can't self-redirect. */
    submitAuthCode: procedure
        .input(z.object({ code: z.string().min(1) }))
        .mutation(({ input }) => {
            submitAuthCode(input.code)
            return { success: true }
        }),

    cancelSignIn: procedure
        .mutation(async () => {
            cancelClaudeSignIn()
            await dismissDependency('claudeCli')
            return { success: true }
        }),
})
