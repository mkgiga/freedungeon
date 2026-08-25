import { z } from 'zod'
import { router, procedure } from '../../trpc'
import { state } from '../../server'
import {
    installFromZip,
    setExtensionEnabled,
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
