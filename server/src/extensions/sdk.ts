import type { ExtensionManifest } from '@shared/extensions'
import type { ExtensionStore } from '../extension-state'

/**
 * What an extension is handed when it activates.
 *
 * Injected rather than imported: extensions load from disk at runtime, so a
 * bare `from 'freedungeon'` would need a module resolver or an installed
 * package. Types come from the shipped `freedungeon.d.ts`, so autocomplete
 * still works - types by declaration, runtime by injection.
 */
export type FreedungeonHost = {
    readonly id: string
    readonly manifest: Readonly<ExtensionManifest>

    readonly state: ExtensionStore

    log: (message: string) => void
    warn: (message: string) => void
    error: (message: string) => void

    notify: (opts: { title: string; message: string; kind?: 'info' | 'error' }) => void

    onDispose: (fn: () => void) => void
}

/** The shape an extension's entry module must default-export. */
export type ExtensionModule = {
    activate?: (host: FreedungeonHost) => void | Promise<void>
    deactivate?: () => void | Promise<void>
}
