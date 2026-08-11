import { createContext, onCleanup, onMount, useContext, type JSXElement } from 'solid-js'
import { state } from './state'
import { viewport } from './viewport'
import { ACTIONS, matchesKeybind, resolveKeybind, type ActionId } from '@shared/actions'
import { featureEnabled, type FeatureKey } from '@shared/features'

/**
 * The behaviour half of the action system. shared/actions.ts declares what
 * exists and what key it answers to; this decides what actually happens, and
 * runs it.
 *
 * Handlers are registered by the component that owns them, for their lifetime.
 * That's the scoping mechanism: `chat.regenerate` only does anything while a
 * chat is on screen, because that's the only time anything has claimed it. No
 * `when` predicates to keep in sync with the UI, and an unmounted screen can't
 * be driven by a stray keypress.
 */

type Handler = () => void

type ActionsApi = {
    register: (id: ActionId, handler: Handler) => () => void
    /** Run an action by id, whatever bound it. Returns false if nothing claimed it. */
    invoke: (id: ActionId) => boolean
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
 * Later registrations win. A screen mounted over another (a chat inside a
 * dialog, say) takes the binding while it's up and hands it back on cleanup,
 * which is the behaviour you want without anyone tracking z-order.
 */
export function useAction(id: ActionId, handler: Handler): void {
    const actions = useActions()
    onMount(() => onCleanup(actions.register(id, handler)))
}

/** Whether an action can fire: its owning feature must be on, if it has one. */
function actionAvailable(id: string): boolean {
    const feature = ACTIONS[id]?.feature
    if (!feature) return true
    return featureEnabled(state.userPreferences, feature as FeatureKey)
}

/**
 * Typing must never trigger a command. An `Alt+F` while writing dialogue is a
 * hotkey; a bare `Space` is a space. Rather than guess per-binding, any action
 * whose chord has no modifier is skipped while the focus is somewhere text
 * goes — the composer keeps handling those itself, via matchesKeybind.
 */
function isTextEntry(target: EventTarget | null): boolean {
    const el = target as HTMLElement | null
    if (!el?.closest) return false
    return !!el.closest('input, textarea, select, [contenteditable="true"]')
}

function isBareKey(binding: string): boolean {
    return !binding.includes('+')
}

export function ActionsProvider(props: { children: JSXElement }) {
    // A stack per action: the most recent registration is the live one.
    const handlers = new Map<string, Handler[]>()

    const register = (id: ActionId, handler: Handler) => {
        const stack = handlers.get(id) ?? []
        stack.push(handler)
        handlers.set(id, stack)
        return () => {
            const current = handlers.get(id)
            if (!current) return
            const at = current.lastIndexOf(handler)
            if (at !== -1) current.splice(at, 1)
        }
    }

    const invoke = (id: ActionId): boolean => {
        const stack = handlers.get(id)
        const top = stack?.[stack.length - 1]
        if (!top || !actionAvailable(id)) return false
        top()
        return true
    }

    const keybindOf = (id: ActionId) => resolveKeybind(id, state.userPreferences.keybinds)

    const onKeydown = (e: KeyboardEvent) => {
        // Keybinds are a desktop affordance; a phone has no keys to press and
        // no room in the UI to explain them.
        if (viewport() === 'phone') return

        for (const id of Object.keys(ACTIONS)) {
            const binding = resolveKeybind(id, state.userPreferences.keybinds)
            if (!binding || !matchesKeybind(e, binding)) continue
            if (isBareKey(binding) && isTextEntry(e.target)) continue
            if (!handlers.get(id)?.length) continue
            if (!actionAvailable(id)) continue
            e.preventDefault()
            invoke(id as ActionId)
            return
        }
    }

    onMount(() => document.addEventListener('keydown', onKeydown))
    onCleanup(() => document.removeEventListener('keydown', onKeydown))

    return (
        <ActionsContext.Provider value={{ register, invoke, keybindOf }}>
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
