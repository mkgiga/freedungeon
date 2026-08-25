import type { AppState } from './types'
import type { FeatureKey } from './features'

/**
 * Named things the app can do, and the keys that trigger them.
 *
 * Declared the same way features are: a static registry of *data*, so the
 * settings UI can render an editor for it and anything can ask "what is bound
 * to X?" without knowing who implements it. The behaviour itself is registered
 * separately on the client (see client/src/actions.tsx) — a keybind has to
 * cross into userPreferences, and a callback can't.
 *
 * Ids are namespaced `area.verb`. When features become extensions, an extension
 * declares actions under its own namespace and nothing else changes: `feature`
 * already scopes an action's lifetime to its owner being enabled.
 *
 * Keybinds are desktop-only by definition — a touch screen has no keys — so
 * nothing here is dispatched on a phone.
 */
export type ActionSpec = {
    id: string
    label: string
    description?: string
    defaultKeybind?: string
    feature?: FeatureKey
    canExecute?: (ctx: ActionContext) => boolean
}

/** What a declaration-site `canExecute` is given. */
export type ActionContext = {
    state: AppState
}

export const ACTIONS: Record<string, ActionSpec> = {
    'chat.send': {
        id: 'chat.send',
        label: 'Send message',
        description: 'While the composer is focused. Shift+Enter always inserts a line break.',
        defaultKeybind: 'Enter',
        canExecute: ({ state }) => !state.isGenerating,
    },
    'chat.advance': {
        id: 'chat.advance',
        label: 'Continue',
        description: 'Reveal the next line while a scene is playing.',
        defaultKeybind: 'Space',
    },
    'chat.regenerate': {
        id: 'chat.regenerate',
        label: 'Regenerate last turn',
        defaultKeybind: 'Alt+R',
        canExecute: ({ state }) => !state.isGenerating,
    },
    'chat.fastForward': {
        id: 'chat.fastForward',
        label: 'Fast forward',
        description: 'Let the story continue without adding anything of your own.',
        defaultKeybind: 'Alt+F',
        canExecute: ({ state }) => !state.isGenerating,
    },
    'chat.toggleSidebar': {
        id: 'chat.toggleSidebar',
        label: 'Toggle actors & notes panel',
        defaultKeybind: 'Alt+B',
    },
    'app.preferences': {
        id: 'app.preferences',
        label: 'Open preferences',
        defaultKeybind: 'Ctrl+,',
    },
    'app.help': {
        id: 'app.help',
        label: 'Open help',
        defaultKeybind: 'F1',
    },
}

export type ActionId = keyof typeof ACTIONS

/** User overrides, stored in `userPreferences.keybinds`. null means unbound. */
export type KeybindOverrides = Record<string, string | null>

/**
 * Canonical text for a key combination: modifiers in a fixed order, then the
 * key. Fixed order matters — `Shift+Ctrl+K` and `Ctrl+Shift+K` are the same
 * chord, and comparing raw strings would say otherwise.
 *
 * Returns null for a lone modifier press, so holding Ctrl while choosing a
 * binding doesn't record `Ctrl+Control`.
 */
export function keybindFromEvent(e: {
    key: string
    ctrlKey: boolean
    altKey: boolean
    shiftKey: boolean
    metaKey: boolean
}): string | null {
    const key = e.key
    if (key === 'Control' || key === 'Alt' || key === 'Shift' || key === 'Meta') return null

    const parts: string[] = []
    if (e.ctrlKey) parts.push('Ctrl')
    if (e.altKey) parts.push('Alt')
    if (e.shiftKey) parts.push('Shift')
    if (e.metaKey) parts.push('Meta')
    parts.push(normalizeKey(key))
    return parts.join('+')
}

function normalizeKey(key: string): string {
    if (key === ' ') return 'Space'
    if (key.length === 1) return key.toUpperCase()
    return key
}

/** Whether an event is exactly this binding. */
export function matchesKeybind(
    e: { key: string; ctrlKey: boolean; altKey: boolean; shiftKey: boolean; metaKey: boolean },
    binding: string | null | undefined,
): boolean {
    if (!binding) return false
    return keybindFromEvent(e) === binding
}

/**
 * The binding in force for an action: the user's override if they set one,
 * otherwise the shipped default. `null` (explicitly unbound) is preserved and
 * must not fall back to the default, which is why this can't be a `??` chain.
 */
export function resolveKeybind(id: string, overrides: KeybindOverrides | undefined): string | null {
    if (overrides && id in overrides) return overrides[id] ?? null
    return ACTIONS[id]?.defaultKeybind ?? null
}

/** Actions currently bound to `binding`, excluding `exceptId`. */
export function conflictsFor(
    binding: string,
    overrides: KeybindOverrides | undefined,
    exceptId?: string,
): ActionSpec[] {
    return Object.values(ACTIONS).filter(
        a => a.id !== exceptId && resolveKeybind(a.id, overrides) === binding,
    )
}
