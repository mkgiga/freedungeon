/**
 * What an extension declares about itself.
 * 
 * Split from the code deliberately: the host reads every manifest at boot to
 * populate the extensions list, but only *executes* the ones that are enabled.
 * A disabled extension can therefore be shown, described and toggled without
 * ever having run — which is the difference between a list of installed things
 * and a list of things you've already trusted.
 *
 * Everything else an extension declares (settings, state defaults, actions,
 * tools) is registered from inside `activate` against the injected host, so
 * there is one source of truth rather than a manifest that has to be kept in
 * step with the code.
 */
export type ExtensionManifest = {
    /**
     * Reverse-DNS identifier, e.g. `com.author.dice-roller`. Stable forever:
     * it keys the extension's persisted state, its enabled flag and its
     * settings, so changing it orphans all three.
     */
    id: string
    name: string
    version: string
    description?: string
    author?: string
    /** Entry point relative to the extension directory. TypeScript is fine. */
    main: string
    /**
     * Which half of the app this runs in, borrowing the browser-extension
     * split: `background` is the server (state, tools, macros), `content` is
     * the client (UI). Only `background` is loaded today; a manifest may
     * declare `content` ahead of that support, and it is ignored rather than
     * rejected so an extension written for a later version still installs.
     */
    background?: string
    content?: string
}

export type ExtensionStatus =
    /** Manifest read, not executed — either disabled or not yet activated. */
    | 'installed'
    | 'active'
    /** Its manifest is unusable; `error` says why. Never executed. */
    | 'invalid'
    /** `activate` threw; `error` carries the message. */
    | 'failed'

export type ExtensionInfo = {
    manifest: ExtensionManifest
    status: ExtensionStatus
    /** Absolute path to the extension's directory. */
    dir: string
    error?: string
}

const ID_PATTERN = /^[a-z0-9]+(?:[.-][a-z0-9]+)+$/

/**
 * Validate a parsed manifest, returning an error string or null.
 *
 * Strict about `id` because it is a storage key and a filesystem-adjacent
 * name; lax about everything else, since a manifest from a newer version of
 * the app should degrade rather than fail to install.
 */
export function validateManifest(value: unknown): string | null {
    if (!value || typeof value !== 'object') return 'manifest is not an object'
    const m = value as Partial<ExtensionManifest>
    if (typeof m.id !== 'string' || !ID_PATTERN.test(m.id)) {
        return 'id must look like "com.author.name" (lowercase, dot or dash separated)'
    }
    if (typeof m.name !== 'string' || !m.name.trim()) return 'name is required'
    if (typeof m.version !== 'string' || !m.version.trim()) return 'version is required'
    const entry = m.background ?? m.main
    if (typeof entry !== 'string' || !entry.trim()) return 'main (or background) is required'
    // A path that climbs out of the extension directory would let a manifest
    // point the loader anywhere on disk.
    if (entry.includes('..')) return 'entry path must stay inside the extension directory'
    return null
}

/** The file the host loads for the server half. */
export function backgroundEntry(m: ExtensionManifest): string {
    return m.background ?? m.main
}
