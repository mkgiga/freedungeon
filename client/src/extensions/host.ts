import { createEffect, createRoot, on, onCleanup } from 'solid-js'
import { createStore, produce } from 'solid-js/store'
import { resolveExtensionConfig, type ExtensionInfo, type UiSlot } from '@shared/extensions'
import { state } from '../state'
import { trpc } from '../trpc'

/**
 * One drawing an extension asked for. `mount` is handed an empty element and
 * may return its own teardown - the same shape a Solid `onCleanup` has, so an
 * extension does not have to know what framework it landed in.
 */
export type SlotMount = (el: HTMLElement, ctx: SlotContext) => void | (() => void)

export type SlotContext = {
    readonly slot: UiSlot
    readonly settings: Record<string, unknown>
}

type Contribution = {
    id: string
    slot: UiSlot
    mount: SlotMount
    order: number
}

const [contributions, setContributions] = createStore<{ list: Contribution[] }>({ list: [] })

let nextOrder = 0

export function slotContributions(slot: UiSlot, only?: string): Contribution[] {
    return contributions.list.filter(c => c.slot === slot && (!only || c.id === only))
}

/**
 * What an extension's browser code is handed. The same shape as the server
 * host where the two overlap - `settings`, `state`, `log`, `onDispose` - so
 * one extension's two halves read as one thing.
 */
export type FreedungeonClient = {
    readonly id: string
    readonly manifest: ExtensionInfo['manifest']

    /** Live application state. Read-only here: the client never writes state. */
    readonly state: typeof state
    readonly settings: {
        readonly values: Record<string, unknown>
        get<T>(name: string, fallback?: T): T
    }

    ui: {
        slot(slot: UiSlot, mount: SlotMount): () => void
    }

    /** Reach this extension's own server side. Answered by `fd.onCall` there. */
    call(name: string, args?: Record<string, unknown>): Promise<unknown>

    /** Re-run `react` whenever `read` returns something new. */
    watch<T>(read: () => T, react: (value: T) => void): () => void

    log(message: string): void
    warn(message: string): void
    error(message: string): void

    onDispose(fn: () => void): void
}

type LoadedExtension = {
    dispose: () => void
}

const running = new Map<string, LoadedExtension>()

function settingsOf(info: ExtensionInfo): Record<string, unknown> {
    return resolveExtensionConfig(info.settings, state.userPreferences.extensions?.[info.manifest.id]).values
}

function buildClient(info: ExtensionInfo, disposers: (() => void)[]): FreedungeonClient {
    const id = info.manifest.id
    const prefix = `[ext:${id}]`

    return {
        id,
        manifest: info.manifest,
        state,
        settings: {
            get values() {
                return settingsOf(info)
            },
            get(name, fallback) {
                const value = settingsOf(info)[name]
                return (value === undefined ? fallback : value) as never
            },
        },
        ui: {
            slot(slot, mount) {
                const entry: Contribution = { id, slot, mount, order: nextOrder++ }
                setContributions('list', list => [...list, entry])
                const remove = () => setContributions('list', produce(list => {
                    const at = list.indexOf(entry)
                    if (at !== -1) list.splice(at, 1)
                }))
                disposers.push(remove)
                return remove
            },
        },
        call: async (name, args) => {
            const { result } = await trpc.extensions.invoke.mutate({ id, name, args: args ?? {} })
            return result
        },
        watch(read, react) {
            const stop = createRoot((dispose) => {
                createEffect(on(read, react, { defer: true }))
                return dispose
            })
            disposers.push(stop)
            return stop
        },
        log: (m) => console.log(`${prefix} ${m}`),
        warn: (m) => console.warn(`${prefix} ${m}`),
        error: (m) => console.error(`${prefix} ${m}`),
        onDispose: (fn) => { disposers.push(fn) },
    }
}

async function start(info: ExtensionInfo): Promise<void> {
    const id = info.manifest.id
    if (running.has(id) || !info.contentUrl) return

    const disposers: (() => void)[] = []
    // Claimed before the import resolves, so a rapid off/on cannot start the
    // same extension twice.
    running.set(id, { dispose: () => { for (const d of disposers.reverse()) d() } })

    try {
        const mod = await import(/* @vite-ignore */ `${info.contentUrl}?v=${info.manifest.version}`)
        const entry = mod.default ?? mod
        await entry.activate?.(buildClient(info, disposers))
        console.log(`[ext:${id}] browser code loaded`)
    } catch (err) {
        console.error(`[ext:${id}] browser code failed to load`, err)
        stop(id)
    }
}

function stop(id: string): void {
    const entry = running.get(id)
    if (!entry) return
    running.delete(id)
    try { entry.dispose() } catch (err) { console.warn(`[ext:${id}] teardown threw`, err) }
}

/**
 * Follows the server's published list rather than keeping its own: an
 * extension switched off there has its code taken out of the page here,
 * without a second channel to keep in step.
 */
export function mountExtensionHost(): void {
    createEffect(() => {
        const infos = Object.values(state.extensions ?? {})
        const wanted = new Set(
            infos.filter(i => i.status === 'active' && i.contentUrl).map(i => i.manifest.id),
        )

        for (const id of [...running.keys()]) if (!wanted.has(id)) stop(id)
        for (const info of infos) if (wanted.has(info.manifest.id)) void start(info)
    })

    onCleanup(() => { for (const id of [...running.keys()]) stop(id) })
}
