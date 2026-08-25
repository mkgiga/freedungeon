import { z } from 'zod'
import { router, procedure } from '../../trpc'
import {
    ensureDependency,
    planDependencies,
    dismissDependency,
    verifyDependency,
    beginClaudeSignIn,
    submitAuthCode,
    cancelClaudeSignIn,
} from '../../dependencies'
import { DEPENDENCIES, type DependencyKey } from '@shared/dependencies'

const key = z.object({
    key: z.enum(Object.keys(DEPENDENCIES) as [DependencyKey, ...DependencyKey[]]),
})

export const dependenciesRouter = router({
    plan: procedure
        .input(z.object({ keys: z.array(z.enum(Object.keys(DEPENDENCIES) as [DependencyKey, ...DependencyKey[]])) }))
        .query(({ input }) => planDependencies(input.keys)),

    ensure: procedure
        .input(key)
        .mutation(async ({ input }) => {
            await ensureDependency(input.key)
            return { success: true }
        }),

    dismiss: procedure
        .input(key)
        .mutation(async ({ input }) => {
            await dismissDependency(input.key)
            return { success: true }
        }),

    verify: procedure
        .input(key)
        .mutation(async ({ input }) => {
            return { status: await verifyDependency(input.key) }
        }),

    signIn: procedure
        .mutation(async () => {
            await beginClaudeSignIn()
            return { success: true }
        }),

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
