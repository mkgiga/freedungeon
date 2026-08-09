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

export type DependencyKey = 'claudeCli' | 'rmbgModel'

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
}

/** Static descriptions; the live status lives in `state.dependencies`. */
export const DEPENDENCIES: Record<DependencyKey, { label: string; reason: string }> = {
    claudeCli: {
        label: 'Claude Code',
        reason: 'Anthropic models run through the Claude Code CLI, downloaded from Anthropic.',
    },
    rmbgModel: {
        label: 'RMBG-1.4 weights',
        reason: 'Runs locally to cut backgrounds out of item icons.',
    },
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
