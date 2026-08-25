import { mutate, state } from './server'

/**
 * The authoring surface for an extension's own persisted state.
 *
 * `mutate(s => { s.extensionState.myext.a.b = value })` is the funnel, and it
 * is a poor thing to ask a plugin author to write: path-as-arguments, and it
 * throws if any level is missing. This wraps it so the extension writes what it
 * means.
 *
 * Built on `mutate`, which is Immer underneath. Not on Solid's reactivity: the
 * server resolves solid-js's SSR build, where the store is inert — an effect
 * never runs — so `createMutable` plus a change listener, the obvious design,
 * can observe nothing here. Immer gives the same ergonomics and, unlike a
 * listener, reports exactly which leaves changed.
 *
 * One write per `update` call regardless of how many fields it touches, so a
 * batch of related changes is a single database write and a single socket
 * patch instead of one each.
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
