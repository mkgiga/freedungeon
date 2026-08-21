/**
 * External files the app needs but doesn't ship: large third-party binaries and
 * model weights, fetched on demand into the data dir.
 *
 * These are declared rather than hardcoded at each call site so that any
 * feature can state what it depends on, the server can answer "is this usable?"
 * from anywhere, and the client can render the same patcher UI for all of them
 * without knowing what any individual dependency is.
 *
 * Presence on disk is deliberately NOT the readiness signal — an interrupted
 * download leaves a file that exists but is unusable. Readiness means the bytes
 * match a publisher-provided sha256; see server/src/dependencies.ts.
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
    /** Verified against its expected hash — safe to use. */
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
    /** Shown as the patcher's title. */
    label: string
    /** One line on why the user is being asked to wait for this. */
    reason: string
    status: DependencyStatus
    /** Bytes written so far, while downloading. */
    received?: number
    /** Total expected bytes, when the server advertises a length. */
    total?: number
    /** Set when status is 'failed'. */
    error?: string
    /** While 'authenticating': the URL the user must visit to authorize. */
    authUrl?: string
    /** While 'authenticating': whether the CLI is waiting on a pasted code. */
    awaitingCode?: boolean
    /** While 'satisfied': who is signed in, for display. */
    account?: string
    /**
     * The feature this file serves, or absent for the app itself.
     *
     * This is the link that lets one function answer "may a turn run right
     * now?" — without it, a download is an anonymous progress bar and nothing
     * can tell whether the thing it unblocks is even switched on.
     */
    feature?: string
    /**
     * Whether this machine actually needs the file.
     *
     * Every dependency gets an entry regardless of platform, so the CUDA
     * runtime is reported as 'missing' on a Mac that will never want it.
     * Computed server-side because only the server can tell — it is the side
     * that probed the GPU.
     */
    required: boolean
}

/**
 * Dependencies that must land before an agent turn may run.
 *
 * One function, shared: the server refuses prompts with it and the client
 * disables the composer with it, so the two cannot disagree about whether the
 * app is usable. Both inputs are already replicated state.
 *
 * A dependency counts only when this machine needs it AND the feature that
 * wants it is switched on. Turning image generation off is therefore a valid
 * way out of the wait — the files stop being anyone's problem.
 */
export function turnBlockers(
    dependencies: Record<string, DependencyState>,
    features: Record<string, { enabled: boolean }> | undefined,
): DependencyState[] {
    return Object.values(dependencies ?? {}).filter((dep) => {
        if (!dep.required || dep.status === 'satisfied') return false
        // No feature means the app core (the Claude CLI): always counts.
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
    // Image generation. One dependency per file rather than one bundle, so the
    // patcher shows real movement across a ~3 GB first run instead of a single
    // bar that appears stuck for minutes at a time.
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
    /** Bytes still to fetch; 0 when the size could not be determined. */
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
