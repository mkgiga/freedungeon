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
    /** Current values. Read-only — mutating this does not persist or replicate. */
    readonly values: T
    /** Replace one declared value. */
    set<K extends keyof T & string>(name: K, value: T[K]): void
    /** Remove a value entirely, dropping its row. */
    remove(name: keyof T & string): void
    /**
     * Mutate the extension's state as if it were a plain object.
     *
     *   store.update(d => { d.counter++; d.cfg = { theme: 'dark' } })
     *
     * Assigning a new key works; reaching *through* one that doesn't exist yet
     * does not, because the draft is an ordinary object and `d.a.b = 1` reads
     * `d.a` first. Assign the level, then fill it.
     */
    update(fn: (draft: T) => void): void
}

export function extensionStore<T extends Record<string, unknown> = Record<string, unknown>>(
    key: string,
): ExtensionStore<T> {
    // The bag is seeded at boot for every declaring feature (see
    // seedExtensionState). An extension registered at runtime may not have one
    // yet, and setState cannot create a missing level — so make it here.
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
            // The draft is already a mutable proxy, so the author's function runs
            // directly against it — no nested producer.
            mutate(s => { fn((s.extensionState[key] ??= {}) as T) })
        },
    }
}
