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
    /** This extension's own id, so it never has to hardcode it. */
    readonly id: string
    readonly manifest: Readonly<ExtensionManifest>

    /**
     * Persisted, replicated state scoped to this extension. Writes reach the
     * database and the client through the same funnel core code uses.
     */
    readonly state: ExtensionStore

    /** Prefixed with the extension id, so a noisy extension is identifiable. */
    log: (message: string) => void
    warn: (message: string) => void
    error: (message: string) => void

    /** Raise a toast. Same notification path the app itself uses. */
    notify: (opts: { title: string; message: string; kind?: 'info' | 'error' }) => void

    /**
     * Register teardown. Runs when the extension is disabled, uninstalled or
     * reloaded — the counterpart to anything `activate` starts (timers,
     * listeners, watchers). Extensions that leak these survive their own
     * deactivation, which is the usual way a plugin host becomes unreliable.
     */
    onDispose: (fn: () => void) => void
}

/** The shape an extension's entry module must default-export. */
export type ExtensionModule = {
    activate?: (host: FreedungeonHost) => void | Promise<void>
    deactivate?: () => void | Promise<void>
}
