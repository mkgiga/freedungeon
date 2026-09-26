/**
 * Presence on disk is NOT readiness: an interrupted download leaves a file that
 * exists but is unusable. Readiness means the bytes match a publisher sha256.
 */

export type DependencyKey =
    | 'claudeCli'
    | 'rmbgModel'
    | 'sdServer'
    | 'sdCudaRuntime'
    | 'sdDiffusionModel'
    | 'sdVae'
    | 'sdTextEncoder'

export type DependencyStatus =
    | 'satisfied'
    /** Not downloaded yet. */
    | 'missing'
    /** Present but the hash didn't match: truncated, corrupted, or tampered. */
    | 'corrupt'
    | 'downloading'
    /** The last attempt failed; `error` says why. Retryable. */
    | 'failed'
    /**
     * On disk and verified, but unusable until the user signs in. Distinct from
     * 'missing' because there is nothing to download — the fix is an auth flow.
     */
    | 'unauthenticated'
    /** A sign-in is in progress; `authUrl` is waiting to be visited. */
    | 'authenticating'

export type DependencyState = {
    key: DependencyKey
    label: string
    reason: string
    status: DependencyStatus
    received?: number
    total?: number
    error?: string
    authUrl?: string
    awaitingCode?: boolean
    account?: string
    /** Only wanted while the extension that claims it is switched on. */
    extension?: string
    /** Only wanted while a config of this provider is the active one. */
    provider?: string
    required: boolean
}

/**
 * Whether this machine currently wants a dependency at all.
 *
 * A dependency is claimed by an extension or by a provider, and is irrelevant
 * unless that owner is selected. Anything unclaimed is wanted unconditionally.
 */
export function isRelevant(
    dep: DependencyState,
    extensions: Record<string, { enabled: boolean }> | undefined,
    activeProvider: string | undefined,
): boolean {
    if (!dep.required) return false
    if (dep.provider) return dep.provider === activeProvider
    if (dep.extension) return extensions?.[dep.extension]?.enabled === true
    return true
}

/**
 * Dependencies that must land before an agent turn may run.
 *
 * Shared: the server refuses prompts with it and the client disables the
 * composer with it, so the two can't disagree. Switching off the extension -
 * or the provider - that wants a file is a valid way out of the wait.
 */
export function turnBlockers(
    dependencies: Record<string, DependencyState>,
    extensions: Record<string, { enabled: boolean }> | undefined,
    activeProvider?: string,
): DependencyState[] {
    return Object.values(dependencies ?? {}).filter((dep) =>
        dep.status !== 'satisfied' && isRelevant(dep, extensions, activeProvider))
}

export const DEPENDENCIES: Record<DependencyKey, { label: string; reason: string; extension?: string; provider?: string }> = {
    claudeCli: {
        label: 'Claude Code',
        reason: 'Anthropic models run through Claude Code, downloaded from Anthropic.',
        provider: 'anthropic',
    },
    rmbgModel: {
        label: 'RMBG-1.4 weights',
        reason: 'Runs locally to cut backgrounds out of item icons.',
        extension: 'core.imageGeneration',
    },
    sdServer: {
        label: 'Image generator',
        reason: 'stable-diffusion.cpp runs the image model on your own machine.',
        extension: 'core.imageGeneration',
    },
    sdCudaRuntime: {
        label: 'CUDA runtime',
        reason: 'NVIDIA GPU acceleration for the image generator.',
        extension: 'core.imageGeneration',
    },
    sdDiffusionModel: {
        label: 'Anima weights',
        reason: 'The model that draws the picture.',
        extension: 'core.imageGeneration',
    },
    sdVae: {
        label: 'Anima VAE',
        reason: 'Turns what the model produces into a viewable image.',
        extension: 'core.imageGeneration',
    },
    sdTextEncoder: {
        label: 'Qwen3 text encoder',
        reason: 'Reads your prompt for the image model.',
        extension: 'core.imageGeneration',
    },
}

/**
 * Only ever describes dependencies that are NOT already satisfied - an empty
 * plan means the extension is ready and nothing needs asking.
 */
export type DependencyPlanItem = {
    key: DependencyKey
    label: string
    reason: string
    status: DependencyStatus
    bytes: number
}

/**
 * A dependency blocks the UI while it is being resolved, and while it is
 * resolvable-but-not-yet-usable. 'missing' does NOT block: nothing has asked
 * for it yet, and the patcher only appears once something does.
 */
export function isBlocking(dep: DependencyState): boolean {
    return dep.status === 'downloading'
        || dep.status === 'failed'
        || dep.status === 'unauthenticated'
        || dep.status === 'authenticating'
}
