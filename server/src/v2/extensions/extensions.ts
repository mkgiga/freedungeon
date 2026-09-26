import { z } from 'zod'
import { router, procedure } from '../../trpc'
import { state } from '../../server'
import { planDependencies } from '../../dependencies'
import { requiredSdDependencies } from '../../sd/server'
import { getSdBuildChoice } from '../../sd/dependency'
import { dispatchCall } from '../../extensions/registry'
import {
    installFromZip,
    setExtensionEnabled,
    setExtensionSettings,
    uninstallExtension,
    rescanExtensions,
} from '../../extensions/host'

export const extensionsRouter = router({
    rescan: procedure
        .mutation(async () => ({ found: (await rescanExtensions()).length })),

    setEnabled: procedure
        .input(z.object({ id: z.string(), enabled: z.boolean() }))
        .mutation(async ({ input }) => {
            await setExtensionEnabled(input.id, input.enabled)
            return state.extensions[input.id] ?? null
        }),

    setSettings: procedure
        .input(z.object({ id: z.string(), values: z.record(z.string(), z.any()) }))
        .mutation(async ({ input }) => setExtensionSettings(input.id, input.values)),

    /**
     * The bridge an extension's browser code reaches its own server side over.
     * Named `invoke` because tRPC reserves `call` on a router.
     */
    invoke: procedure
        .input(z.object({
            id: z.string(),
            name: z.string(),
            args: z.record(z.string(), z.any()).optional(),
        }))
        .mutation(async ({ input }) => ({
            result: await dispatchCall(input.id, input.name, input.args ?? {}),
        })),

    /**
     * What switching image generation on will download. Asked before the
     * toggle, so the user agrees to the size rather than discovering it.
     */
    imageGenPlan: procedure.query(async () => {
        const choice = getSdBuildChoice()
        if (choice && !choice.supported) {
            return { supported: false as const, title: choice.title, message: choice.message, items: [] }
        }
        return { supported: true as const, items: await planDependencies(requiredSdDependencies()) }
    }),

    installFromZip: procedure
        .input(z.object({ path: z.string().min(1) }))
        .mutation(async ({ input }) => installFromZip(input.path)),

    uninstall: procedure
        .input(z.object({ id: z.string() }))
        .mutation(async ({ input }) => {
            await uninstallExtension(input.id)
            return { success: true }
        }),
})
