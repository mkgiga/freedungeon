import type { SchemaField } from '@shared/schema-ui'
import type { ExtensionEventName, ExtensionEvents } from '@shared/extension-events'
import { log } from '../logger'

/**
 * What one running extension has registered. Membership in this map *is* the
 * definition of active: contributions go in when `activate` succeeds and come
 * out when it is disposed, so nothing has to cross-check an enabled flag.
 *
 * A leaf module on purpose. `macro.ts` and `agent.ts` read it every turn, and
 * routing those reads through `host.ts` would tie them to `server.ts`, which
 * imports both.
 */
export type Contributions = {
    settings: SchemaField[]
    sections: (() => string | null | undefined)[]
    scopes: Map<string, () => unknown>
    calls: Map<string, (args: Record<string, unknown>) => unknown | Promise<unknown>>
    settingsListeners: ((next: Record<string, unknown>, prev: Record<string, unknown>) => void | Promise<void>)[]
    events: Map<string, ((payload: unknown) => void)[]>
    disposers: (() => void)[]
}

const active = new Map<string, Contributions>()

export function openContributions(id: string): Contributions {
    const fresh: Contributions = {
        settings: [],
        sections: [],
        scopes: new Map(),
        calls: new Map(),
        settingsListeners: [],
        events: new Map(),
        disposers: [],
    }
    active.set(id, fresh)
    return fresh
}

export function contributionsOf(id: string): Contributions | undefined {
    return active.get(id)
}

/**
 * Runs the extension's own disposers before dropping it, newest first, so
 * teardown unwinds in the order setup was written.
 */
export function closeContributions(id: string): void {
    const entry = active.get(id)
    if (!entry) return
    active.delete(id)
    for (const dispose of entry.disposers.reverse()) {
        try { dispose() } catch (err) { log.server.warn(`[ext:${id}] disposer threw: ${err}`) }
    }
}

export function isExtensionActive(id: string): boolean {
    return active.has(id)
}

export function activeExtensionIds(): string[] {
    return [...active.keys()]
}

/** Every active extension's contributed system-prompt text, in id order. */
export function promptSections(): string[] {
    const out: string[] = []
    for (const [id, entry] of active) {
        for (const section of entry.sections) {
            try {
                const text = section()?.trim()
                if (text) out.push(text)
            } catch (err) {
                log.server.warn(`[ext:${id}] prompt section threw: ${err}`)
            }
        }
    }
    return out
}

/**
 * First registration wins, so a later extension cannot shadow a macro scope
 * another one already answers - the collision is logged where it happens
 * rather than silently changing someone's prompt.
 */
export function promptScope(name: string): (() => unknown) | undefined {
    for (const entry of active.values()) {
        const builder = entry.scopes.get(name)
        if (builder) return builder
    }
    return undefined
}

export function scopeOwner(name: string): string | undefined {
    for (const [id, entry] of active) if (entry.scopes.has(name)) return id
    return undefined
}

export async function dispatchCall(
    id: string,
    name: string,
    args: Record<string, unknown>,
): Promise<unknown> {
    const entry = active.get(id)
    if (!entry) throw new Error(`Extension "${id}" is not running`)
    const handler = entry.calls.get(name)
    if (!handler) throw new Error(`Extension "${id}" has no handler for "${name}"`)
    return await handler(args)
}

/**
 * Fire and forget. A hook is an observer: the app never waits on one, so a
 * handler that throws or hangs costs its own extension and nothing else.
 */
export function emit<E extends ExtensionEventName>(event: E, payload: ExtensionEvents[E]): void {
    for (const [id, entry] of active) {
        for (const handler of entry.events.get(event) ?? []) {
            try {
                const result = handler(payload) as unknown
                if (result instanceof Promise) {
                    result.catch(err => log.server.warn(`[ext:${id}] ${event} handler rejected: ${err}`))
                }
            } catch (err) {
                log.server.warn(`[ext:${id}] ${event} handler threw: ${err}`)
            }
        }
    }
}

/**
 * Settings listeners are the exception to observer-only: they run before the
 * write and may throw to refuse it, which is how an extension declines a
 * setting it cannot honour yet.
 */
export async function notifySettingsChange(
    id: string,
    next: Record<string, unknown>,
    prev: Record<string, unknown>,
): Promise<void> {
    const entry = active.get(id)
    if (!entry) return
    for (const listener of entry.settingsListeners) await listener(next, prev)
}
