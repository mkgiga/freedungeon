/**
 * Authoring types for the freedungeon extension host.
 *
 * Types only — the real object is handed to `activate` at runtime, because an
 * extension is loaded from wherever you put it and a bare `import` of the host
 * would have nothing to resolve against. Copy this file next to your source to
 * get autocomplete.
 */
export type ExtensionStore = {
    /** Current values. Read-only; mutating this does not persist. */
    readonly values: Record<string, unknown>
    set(name: string, value: unknown): void
    remove(name: string): void
    /**
     * Mutate your state as a plain object. Assigning a new key works; reaching
     * through one that doesn't exist yet does not — assign the level first.
     */
    update(fn: (draft: Record<string, unknown>) => void): void
}

export type FreedungeonHost = {
    readonly id: string
    readonly manifest: { id: string; name: string; version: string; description?: string }
    readonly state: ExtensionStore
    log(message: string): void
    warn(message: string): void
    error(message: string): void
    notify(opts: { title: string; message: string; kind?: 'info' | 'error' }): void
    /** Register teardown; runs on disable, uninstall and reload. */
    onDispose(fn: () => void): void
}
