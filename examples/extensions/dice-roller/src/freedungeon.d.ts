/**
 * Authoring types for the freedungeon extension host.
 *
 * Types only — the real object is handed to `activate` at runtime, because an
 * extension is loaded from wherever you put it and a bare `import` of the host
 * would have nothing to resolve against. Copy this file next to your source to
 * get autocomplete.
 */
export type ExtensionStore = {
    readonly values: Record<string, unknown>
    set(name: string, value: unknown): void
    remove(name: string): void
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
    onDispose(fn: () => void): void
}
