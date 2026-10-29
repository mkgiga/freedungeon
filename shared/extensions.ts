import type { SchemaField } from './schema-ui'

/**
 * Split from the code so a disabled extension can be listed, described and
 * toggled without ever having run. Everything else - hooks, prompt sections,
 * call handlers, UI - is registered from inside `activate`.
 */
export type ExtensionManifest = {
    id: string
    name: string
    version: string
    description?: string
    author?: string
    main: string
    /** Server entry. Falls back to `main`. */
    background?: string
    /** Browser entry, served to the page while the extension is active. */
    content?: string
}

export type ExtensionStatus =
    | 'installed'
    | 'active'
    /** Its manifest is unusable; `error` says why. Never executed. */
    | 'invalid'
    /** `activate` threw; `error` carries the message. */
    | 'failed'

/**
 * Where an extension's browser code can draw. Fixed set: a slot is a promise
 * about layout, and one the app cannot keep is worse than none.
 */
export const UI_SLOTS = {
    'app.leftNav': 'Under the navigation buttons. Tablet and desktop only.',
    'app.overlay': 'A layer over the whole app.',
    'chat.hud': 'The strip above the composer, after the inventory.',
    'chat.sidebar': 'The bottom of the actors and notes panel.',
    'settings.extension': "The extension's own block in Preferences.",
} as const

export type UiSlot = keyof typeof UI_SLOTS

export type ExtensionInfo = {
    manifest: ExtensionManifest
    status: ExtensionStatus
    /** Empty for built-ins - they ship in the bundle, not on disk. */
    dir: string
    /** Built-ins cannot be uninstalled and are always listed. */
    builtIn: boolean
    /**
     * The app doesn't work without it, so it has no switch - not a disabled
     * one, none. Distinct from `builtIn`: choice prompts ship with the app and
     * are still entirely optional.
     *
     * Only a built-in can claim this. It is set where the built-in is
     * registered, never read from a manifest, so a dropped-in folder cannot
     * make itself unremovable.
     */
    required: boolean
    error?: string
    /**
     * Registered from `activate`, so an extension that isn't running has none.
     * That is the same rule the settings form already followed: there is
     * nothing to configure about something that isn't on.
     */
    settings: SchemaField[]
    /** Served URL of the browser entry, present only while active. */
    contentUrl?: string
}

export type ExtensionConfig = {
    enabled: boolean
    values: Record<string, unknown>
}

/**
 * Lowercase head per segment, camelCase tail - `core.choicePrompts` and
 * `com.example.dice-roller` both read as one identifier.
 */
const ID_PATTERN = /^[a-z][a-zA-Z0-9]*(?:[.-][a-z][a-zA-Z0-9]*)+$/

/** Built-ins own this prefix; a dropped-in folder cannot claim it. */
export const CORE_NAMESPACE = 'core.'

export function isCoreId(id: string): boolean {
    return id === 'core' || id.startsWith(CORE_NAMESPACE)
}

/**
 * Strict about `id` - it is a storage key and a filesystem-adjacent name. Lax
 * about the rest, so a manifest from a newer version degrades rather than
 * failing to install.
 */
export function validateManifest(value: unknown): string | null {
    if (!value || typeof value !== 'object') return 'manifest is not an object'
    const m = value as Partial<ExtensionManifest>
    if (typeof m.id !== 'string' || !ID_PATTERN.test(m.id)) {
        return 'id must look like "com.author.name" (dot or dash separated, each part starting lowercase)'
    }
    if (isCoreId(m.id)) return 'the "core" namespace is reserved for built-in extensions'
    if (typeof m.name !== 'string' || !m.name.trim()) return 'name is required'
    if (typeof m.version !== 'string' || !m.version.trim()) return 'version is required'
    const entry = m.background ?? m.main
    if (typeof entry !== 'string' || !entry.trim()) return 'main (or background) is required'
    if (entry.includes('..')) return 'entry path must stay inside the extension directory'
    if (typeof m.content === 'string' && m.content.includes('..')) {
        return 'content path must stay inside the extension directory'
    }
    return null
}

export function backgroundEntry(m: ExtensionManifest): string {
    return m.background ?? m.main
}

/**
 * Defaults come off the schema rather than a second `defaults` map, so a field
 * added later cannot arrive without one.
 */
export function settingDefaults(fields: SchemaField[]): Record<string, unknown> {
    return Object.fromEntries(fields.map(f => [f.path[0]!, f.default]))
}

/**
 * Defaults are applied on READ, so a value added after the user last saved
 * arrives with its default rather than as undefined. Disabled by default:
 * nothing switches itself on.
 */
export function resolveExtensionConfig(
    fields: SchemaField[],
    stored: ExtensionConfig | undefined,
): ExtensionConfig {
    return {
        enabled: stored?.enabled ?? false,
        values: { ...settingDefaults(fields), ...(stored?.values ?? {}) },
    }
}

export function extensionEnabled(
    prefs: { extensions?: Record<string, ExtensionConfig> },
    id: string,
): boolean {
    return prefs.extensions?.[id]?.enabled === true
}

/**
 * An extension asking the app not to start a turn yet.
 *
 * Distinct from an Activity, which only draws a spinner, and from
 * `isGenerating`, which means the agent is mid-turn and drives the Stop
 * button. A hold is the same kind of thing as an unfinished download: a named
 * reason, replicated, that both the server and the composer read - so the
 * button that refuses and the server that throws cannot disagree.
 *
 * `reason` is shown to the user verbatim, so it is written for them.
 */
export type ExtensionHold = {
    id: string
    extension: string
    reason: string
    startedAt: number
}

/**
 * Held in the order they were taken. Every hold names its extension, because
 * the way out of one that is never released is switching its owner off - which
 * the user can only do if they can see who is holding.
 */
export function heldTurns(
    holds: Record<string, ExtensionHold> | undefined,
): ExtensionHold[] {
    return Object.values(holds ?? {}).sort((a, b) => a.startedAt - b.startedAt)
}
