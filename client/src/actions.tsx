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

/**
 * Conditions on a registration — everything that can't be said in the shared
 * registry, because it isn't shared state.
 */
export type ActionOptions = {
    /**
     * Whether the action can run right now. Evaluated at dispatch time, at the
     * registration site, so it can read anything the client can see: DOM focus,
     * the current route, local signals, and the replicated server state.
     *
     * This is deliberately NOT part of the shared ActionSpec. A predicate
     * declared there could only reach `state`, which is precisely the wrong
     * half for the cases that need it most — "is this input focused" has no
     * representation in application state and shouldn't acquire one.
     */
    enabled?: () => boolean
    /**
     * Let a modifier-less binding fire while focus is in a text field. Off by
     * default, because a bare `Space` belongs to whoever is typing. Turning it
     * on is only safe alongside an `enabled` that scopes to a specific element
     * — otherwise the action fires from every text field in the app.
     */
    whileTyping?: boolean
}

type Registration = { handler: Handler; options: ActionOptions }

type ActionsApi = {
    register: (id: ActionId, handler: Handler, options?: ActionOptions) => () => void
    /** Run an action by id, whatever bound it. Returns false if nothing claimed it. */
    invoke: (id: ActionId) => boolean
    /** Whether something has claimed this action and its conditions are met. */
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
 * Later registrations win. A screen mounted over another (a chat inside a
 * dialog, say) takes the binding while it's up and hands it back on cleanup,
 * which is the behaviour you want without anyone tracking z-order.
 */
export function useAction(id: ActionId, handler: Handler, options?: ActionOptions): void {
    const actions = useActions()
    onMount(() => onCleanup(actions.register(id, handler, options)))
}

/**
 * The conditions the *declaration* imposes: its feature must be on, and its own
 * `canExecute` must pass. Separate from the registration's `enabled` so an
 * action can't be made callable by a handler that forgot the constraint — both
 * gates have to open.
 */
function actionAvailable(id: string): boolean {
    const spec = ACTIONS[id]
    if (!spec) return false
    if (spec.feature && !featureEnabled(state.userPreferences, spec.feature as FeatureKey)) return false
    if (spec.canExecute && !spec.canExecute({ state })) return false
    return true
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
    // A stack per action: the most recent *eligible* registration is the live
    // one. Not simply the last — two composers can be mounted at once (the chat
    // list and a conversation), and the one that answers must be the one whose
    // conditions hold, not whichever mounted later.
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

    /** Topmost registration whose `enabled` holds, if any. */
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
        // Keybinds are a desktop affordance; a phone has no keys to press and
        // no room in the UI to explain them.
        if (viewport() === 'phone') return

        // Mid-IME, a keypress belongs to the input method: Enter commits a
        // candidate rather than meaning Enter. Checked once here rather than in
        // every handler.
        if (e.isComposing) return

        const typing = isTextEntry(e.target)

        for (const id of Object.keys(ACTIONS)) {
            const binding = resolveKeybind(id, state.userPreferences.keybinds)
            if (!binding || !matchesKeybind(e, binding)) continue
            // A modifier-less chord while typing only reaches actions that asked
            // for it — and those are expected to scope themselves to an element.
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
