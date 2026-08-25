import { mutate, state } from './server'

/**
 * Authoring surface for an extension's persisted state. Wraps `mutate` so an
 * extension assigns fields instead of spelling out the path.
 *
 * One write per `update` call however many fields it touches - one DB write,
 * one socket patch. Immer, not Solid reactivity: the server resolves
 * solid-js's SSR build, where the store is inert and effects never run.
 */
export type ExtensionStore<T extends Record<string, unknown> = Record<string, unknown>> = {
    readonly values: T
    set<K extends keyof T & string>(name: K, value: T[K]): void
    remove(name: keyof T & string): void
    update(fn: (draft: T) => void): void
}

export function extensionStore<T extends Record<string, unknown> = Record<string, unknown>>(
    key: string,
): ExtensionStore<T> {
    if (!state.extensionState[key]) mutate(s => { s.extensionState[key] = {} })

    return {
        get values() {
            return (state.extensionState[key] ?? {}) as T
        },
        set(name, value) {
            mutate(s => { s.extensionState[key]![name] = value })
        },
        remove(name) {
            mutate(s => { delete s.extensionState[key]![name] })
        },
        update(fn) {
            mutate(s => { fn((s.extensionState[key] ??= {}) as T) })
        },
    }
}
