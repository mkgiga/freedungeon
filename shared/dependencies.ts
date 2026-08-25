/**
 * External files the app needs but doesn't ship - third-party binaries and
 * model weights, fetched on demand into the data dir.
 *
 * Declared rather than hardcoded per call site, so a feature can state what it
 * needs and the client renders one patcher UI for all of them.
 *
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
    feature?: string
    required: boolean
}

/**
 * Dependencies that must land before an agent turn may run.
 *
 * Shared: the server refuses prompts with it and the client disables the
 * composer with it, so the two can't disagree. A dependency counts only when
 * this machine needs it AND the feature wanting it is on - so switching the
 * feature off is a valid way out of the wait.
 */
export function turnBlockers(
    dependencies: Record<string, DependencyState>,
    features: Record<string, { enabled: boolean }> | undefined,
): DependencyState[] {
    return Object.values(dependencies ?? {}).filter((dep) => {
        if (!dep.required || dep.status === 'satisfied') return false
        if (!dep.feature) return true
        return features?.[dep.feature]?.enabled === true
    })
}

/** Static descriptions; the live status lives in `state.dependencies`. */
export const DEPENDENCIES: Record<DependencyKey, { label: string; reason: string; feature?: string }> = {
    claudeCli: {
        label: 'Claude Code',
        reason: 'Anthropic models run through Claude Code, downloaded from Anthropic.',
    },
    rmbgModel: {
        label: 'RMBG-1.4 weights',
        reason: 'Runs locally to cut backgrounds out of item icons.',
        feature: 'imageGen',
    },
    sdServer: {
        label: 'Image generator',
        reason: 'stable-diffusion.cpp runs the image model on your own machine.',
        feature: 'imageGen',
    },
    sdCudaRuntime: {
        label: 'CUDA runtime',
        reason: 'NVIDIA GPU acceleration for the image generator.',
        feature: 'imageGen',
    },
    sdDiffusionModel: {
        label: 'Anima weights',
        reason: 'The model that draws the picture.',
        feature: 'imageGen',
    },
    sdVae: {
        label: 'Anima VAE',
        reason: 'Turns what the model produces into a viewable image.',
        feature: 'imageGen',
    },
    sdTextEncoder: {
        label: 'Qwen3 text encoder',
        reason: 'Reads your prompt for the image model.',
        feature: 'imageGen',
    },
}

/**
 * One line of "here is what turning this on will download".
 *
 * Only ever describes dependencies that are NOT already satisfied — a plan with
 * no items means the feature is ready and nothing needs asking.
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
