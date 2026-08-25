import type { ExtensionManifest } from '@shared/extensions'
import type { ExtensionStore } from '../extension-state'

/**
 * What an extension is handed when it activates.
 *
 * Injected as an argument rather than imported. An extension is loaded from
 * disk at runtime, so a bare specifier like `import { … } from 'freedungeon'`
 * would have to be resolvable from wherever the user dropped the folder — that
 * means shipping a module resolver, or forcing every author to install a
 * package just to get an object we already hold. Passing it in needs neither.
 *
 * Authoring types come from the shipped `freedungeon.d.ts`, so an author still
 * gets full autocomplete: types by declaration, runtime by injection.
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
