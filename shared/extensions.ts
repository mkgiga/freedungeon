/**
 * What an extension declares about itself.
 *
 * Split from the code: the host reads every manifest at boot but only executes
 * enabled ones, so a disabled extension can be listed, described and toggled
 * without ever having run.
 *
 * Everything else - settings, state defaults, actions, tools - is registered
 * from inside `activate` against the injected host.
 */
export type ExtensionManifest = {
    id: string
    name: string
    version: string
    description?: string
    author?: string
    main: string
    background?: string
    content?: string
}

export type ExtensionStatus =
    | 'installed'
    | 'active'
    /** Its manifest is unusable; `error` says why. Never executed. */
    | 'invalid'
    /** `activate` threw; `error` carries the message. */
    | 'failed'

export type ExtensionInfo = {
    manifest: ExtensionManifest
    status: ExtensionStatus
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
    if (entry.includes('..')) return 'entry path must stay inside the extension directory'
    return null
}

/** The file the host loads for the server half. */
export function backgroundEntry(m: ExtensionManifest): string {
    return m.background ?? m.main
}
