import { createContext, onCleanup, onMount, useContext, type JSXElement } from 'solid-js'
import { state } from './state'
import { viewport } from './viewport'
import { ACTIONS, matchesKeybind, resolveKeybind, type ActionId } from '@shared/actions'
import { featureEnabled, type FeatureKey } from '@shared/features'

type Handler = () => void

/**
 * Conditions on a registration — everything that can't be said in the shared
 * registry, because it isn't shared state.
 */
export type ActionOptions = {
    enabled?: () => boolean
    whileTyping?: boolean
}

type Registration = { handler: Handler; options: ActionOptions }

type ActionsApi = {
    register: (id: ActionId, handler: Handler, options?: ActionOptions) => () => void
    invoke: (id: ActionId) => boolean
    isAvailable: (id: ActionId) => boolean
    keybindOf: (id: ActionId) => string | null
}

const ActionsContext = createContext<ActionsApi>()

export function useActions(): ActionsApi {
    const ctx = useContext(ActionsContext)
    if (!ctx) throw new Error('useActions must be used within <ActionsProvider>')
    return ctx
}

/**
 * Claim an action for as long as the calling component is alive.
 *
 * Later registrations win, so a screen mounted over another takes the binding
 * while it's up and hands it back on cleanup - no z-order tracking needed.
 */
export function useAction(id: ActionId, handler: Handler, options?: ActionOptions): void {
    const actions = useActions()
    onMount(() => onCleanup(actions.register(id, handler, options)))
}

function actionAvailable(id: string): boolean {
    const spec = ACTIONS[id]
    if (!spec) return false
    if (spec.feature && !featureEnabled(state.userPreferences, spec.feature as FeatureKey)) return false
    if (spec.canExecute && !spec.canExecute({ state })) return false
    return true
}

function isTextEntry(target: EventTarget | null): boolean {
    const el = target as HTMLElement | null
    if (!el?.closest) return false
    return !!el.closest('input, textarea, select, [contenteditable="true"]')
}

function isBareKey(binding: string): boolean {
    return !binding.includes('+')
}

export function ActionsProvider(props: { children: JSXElement }) {
    const handlers = new Map<string, Registration[]>()

    const register = (id: ActionId, handler: Handler, options: ActionOptions = {}) => {
        const stack = handlers.get(id) ?? []
        const entry: Registration = { handler, options }
        stack.push(entry)
        handlers.set(id, stack)
        return () => {
            const current = handlers.get(id)
            if (!current) return
            const at = current.indexOf(entry)
            if (at !== -1) current.splice(at, 1)
        }
    }

    const liveFor = (id: string, opts: { typing?: boolean } = {}): Registration | null => {
        if (!actionAvailable(id)) return null
        const stack = handlers.get(id)
        if (!stack) return null
        for (let i = stack.length - 1; i >= 0; i--) {
            const entry = stack[i]!
            if (opts.typing && !entry.options.whileTyping) continue
            if (entry.options.enabled && !entry.options.enabled()) continue
            return entry
        }
        return null
    }

    const invoke = (id: ActionId): boolean => {
        const live = liveFor(id)
        if (!live) return false
        live.handler()
        return true
    }

    const isAvailable = (id: ActionId) => liveFor(id) !== null

    const keybindOf = (id: ActionId) => resolveKeybind(id, state.userPreferences.keybinds)

    const onKeydown = (e: KeyboardEvent) => {
        if (viewport() === 'phone') return

        if (e.isComposing) return

        const typing = isTextEntry(e.target)

        for (const id of Object.keys(ACTIONS)) {
            const binding = resolveKeybind(id, state.userPreferences.keybinds)
            if (!binding || !matchesKeybind(e, binding)) continue
            const live = liveFor(id, { typing: typing && isBareKey(binding) })
            if (!live) continue
            e.preventDefault()
            live.handler()
            return
        }
    }

    onMount(() => document.addEventListener('keydown', onKeydown))
    onCleanup(() => document.removeEventListener('keydown', onKeydown))

    return (
        <ActionsContext.Provider value={{ register, invoke, isAvailable, keybindOf }}>
            {props.children}
        </ActionsContext.Provider>
    )
}

/**
 * The binding for an action, for display. Reads reactively, so a rebind
 * updates any hint showing it without the component knowing it happened.
 */
export function keybindLabel(id: ActionId): string | null {
    return resolveKeybind(id, state.userPreferences.keybinds)
}
