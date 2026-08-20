/**
 * Fetching and verifying the external files declared in shared/dependencies.ts.
 *
 * The integrity problem this solves: a file existing at the expected path does
 * NOT mean the dependency is usable. An interrupted 228MB download leaves a
 * plausible-looking file that fails at load time, and re-running the download
 * would happily skip it. So readiness is defined as "the bytes hash to a value
 * the publisher told us to expect", using the same three-part scheme package
 * managers use (npm integrity, go.sum, Debian SHA256Sums):
 *
 *   1. Download to `<file>.partial`, then rename. Rename is atomic within a
 *      filesystem, so a partial file can never appear at the real path.
 *   2. Verify the content against a publisher-provided sha256 before the file
 *      is ever treated as present.
 *   3. Cache the verification keyed on (size, mtime) so we don't rehash
 *      hundreds of megabytes on every boot, but still notice a file that was
 *      swapped or truncated underneath us.
 *
 * Both checksums come from the publisher, not from us: Anthropic ships a
 * manifest inside the SDK package naming the CLI build it expects, and
 * HuggingFace serves the model's sha256 in its `X-Linked-ETag` header.
 */

import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { DEPENDENCIES, type DependencyKey, type DependencyState } from '@shared/dependencies'
import { NATIVE_DIR, MODELS_DIR, DATA_DIR } from './paths'
import { unzipSync } from 'fflate'
import { SD_MODELS } from './sd/manifest'
import { SD_DIR, sdArchive } from './sd/dependency'
import { mutate, state } from './server'
import { log } from './logger'
// The SDK ships the manifest of the CLI build it expects — version and
// checksum both come from the installed package, so they can't drift apart.
import claudeManifest from '../../integrations/agent-claude/node_modules/@anthropic-ai/claude-agent-sdk/manifest.json' with { type: 'json' }
import claudeZstManifest from '../../integrations/agent-claude/node_modules/@anthropic-ai/claude-agent-sdk/manifest.zst.json' with { type: 'json' }

const RELEASES = 'https://storage.googleapis.com/claude-code-dist-86c565f3-f756-42ad-8dfa-d59b1c096819/claude-code-releases'

/** Where the verification cache lives, so a satisfied dep boots instantly. */
const CACHE_PATH = path.join(DATA_DIR, 'dependencies.json')

type Expected = { sha256: string; bytes: number }

type Spec = {
    /**
     * Absolute path that must exist for this to count as present. For a plain
     * download it is the downloaded file; for an `unpack` spec it is a sentinel
     * inside the unpacked tree (the executable we actually run).
     */
    file: string
    /** Where to fetch it, plus what the bytes must hash to. */
    resolve: () => Promise<{ url: string; expected: Expected; compressed?: 'zstd' }>
    /**
     * Treat the download as a zip and unpack it into `dir`.
     *
     * `expected` then describes the *archive*, not `file` — so an unpacked tree
     * can't be re-verified by hashing one file out of it. Instead a marker
     * recording the archive hash is written beside the tree on success, and
     * checked on later boots. That keeps verification offline and O(1) rather
     * than re-hashing hundreds of megabytes of DLLs at every startup.
     */
    unpack?: { dir: string }
    /** Make it runnable once written (no-op on Windows). */
    executable?: boolean
    /**
     * Extra gate beyond "the bytes are right". The Claude CLI is verified but
     * useless until the user signs in, and that isn't something a download can
     * fix — so it reports 'unauthenticated' rather than pretending to be ready.
     */
    ready?: (file: string) => Promise<{ ok: boolean; account?: string }>
}

function platformKey(): string {
    const arch = process.arch === 'arm64' ? 'arm64' : 'x64'
    if (process.platform === 'win32') return `win32-${arch}`
    if (process.platform === 'darwin') return `darwin-${arch}`
    return `linux-${arch}`
}

const SPECS: Record<DependencyKey, Spec> = {
    claudeCli: {
        file: path.join(NATIVE_DIR, process.platform === 'win32' ? 'claude.exe' : 'claude'),
        executable: true,
        ready: checkClaudeAuth,
        resolve: async () => {
            const key = platformKey()
            const version = claudeManifest.version
            const raw = (claudeManifest.platforms as Record<string, { binary: string; checksum: string; size: number }>)[key]
            const zst = (claudeZstManifest.platforms as Record<string, { binary: string; checksum: string; size: number }>)[key]
            if (!raw) throw new Error(`Claude Code has no build for ${key}`)
            // Prefer the zstd artifact — ~52MB versus ~228MB for the same bytes.
            // We verify against the *decompressed* checksum either way, so a
            // corrupt archive is caught after inflation.
            if (zst) {
                return {
                    url: `${RELEASES}/${version}/${key}/${zst.binary}`,
                    expected: { sha256: raw.checksum, bytes: raw.size },
                    compressed: 'zstd' as const,
                }
            }
            return {
                url: `${RELEASES}/${version}/${key}/${raw.binary}`,
                expected: { sha256: raw.checksum, bytes: raw.size },
            }
        },
    },

    sdServer: {
        // Sentinel is the executable we actually spawn, not the archive: the
        // archive is deleted after unpacking, and this is the file whose absence
        // means "not usable".
        file: path.join(SD_DIR, process.platform === 'win32' ? 'sd-server.exe' : 'sd-server'),
        executable: true,
        unpack: { dir: SD_DIR },
        resolve: async () => sdArchive(0),
    },

    sdCudaRuntime: {
        // Only required on Windows+NVIDIA, where upstream ships the CUDA 12.8.1
        // runtime DLLs as their own archive. It unpacks alongside sd-server
        // because Windows resolves DLLs from the executable's directory.
        file: path.join(SD_DIR, 'cudart64_12.dll'),
        unpack: { dir: SD_DIR },
        resolve: async () => sdArchive(1),
    },

    sdDiffusionModel: {
        file: path.join(MODELS_DIR, SD_MODELS.diffusion.file),
        resolve: async () => ({
            url: SD_MODELS.diffusion.url,
            expected: { sha256: SD_MODELS.diffusion.sha256, bytes: SD_MODELS.diffusion.bytes },
        }),
    },

    sdVae: {
        file: path.join(MODELS_DIR, SD_MODELS.vae.file),
        resolve: async () => ({
            url: SD_MODELS.vae.url,
            expected: { sha256: SD_MODELS.vae.sha256, bytes: SD_MODELS.vae.bytes },
        }),
    },

    sdTextEncoder: {
        file: path.join(MODELS_DIR, SD_MODELS.textEncoder.file),
        resolve: async () => ({
            url: SD_MODELS.textEncoder.url,
            expected: { sha256: SD_MODELS.textEncoder.sha256, bytes: SD_MODELS.textEncoder.bytes },
        }),
    },

    rmbgModel: {
        file: path.join(MODELS_DIR, 'rmbg-1.4-fp16.onnx'),
        resolve: async () => ({
            url: 'https://huggingface.co/briaai/RMBG-1.4/resolve/main/onnx/model_fp16.onnx',
            // Pinned rather than fetched, so verifying an already-downloaded
            // model works offline — the same reason go.sum and npm's integrity
            // field live in the repo instead of being looked up.
            //
            // Sourced from HuggingFace's own X-Linked-ETag (the LFS payload's
            // hash; the plain `etag` is the pointer file's, and the header only
            // appears on the pre-redirect response, not the CDN one). Re-check
            // with:
            //   curl -sI <url> | grep -i x-linked-etag
            expected: {
                sha256: '9fdfdb41866d872e0acf4a010c35c1a8547bf0eebe0d1544406bbf1c824cb59d',
                bytes: 88217533,
            },
        }),
    },
}

// ── Claude sign-in ──────────────────────────────────────────────────────────

/**
 * We deliberately do NOT set CLAUDE_CONFIG_DIR: the CLI reads and writes its
 * credentials in the shared default location, so a user who already has Claude
 * Code signed in needs no auth step here at all, and signing in through this
 * app leaves them signed in everywhere.
 */
type AuthStatus = { loggedIn: boolean; email?: string; orgName?: string; subscriptionType?: string }

/**
 * Locate a usable Claude CLI: the copy we manage, or one the user already has.
 *
 * Plenty of people install Claude Code before they ever run freedungeon — that
 * is how `claude setup-token` works for them — and downloading a second 228MB
 * copy for those users is both wasteful and, when we then fail to pass the path
 * along, actively broken. A system install is accepted as-is: it is whatever
 * version the user chose, so it is deliberately NOT checked against our pinned
 * manifest, which would report a perfectly good binary as corrupt.
 */
export function resolveClaudeCli(): { file: string; managed: boolean } | null {
    const managed = SPECS.claudeCli.file
    if (fs.existsSync(managed)) return { file: managed, managed: true }

    const onPath = Bun.which('claude')
    if (onPath) return { file: onPath, managed: false }

    // The native installer's location, in case PATH isn't inherited (services,
    // detached launches, a shell that never sourced the profile).
    const home = os.homedir()
    const names = process.platform === 'win32' ? ['claude.exe', 'claude'] : ['claude']
    for (const dir of [path.join(home, '.local', 'bin'), path.join(home, '.claude', 'local')]) {
        for (const name of names) {
            const candidate = path.join(dir, name)
            if (fs.existsSync(candidate)) return { file: candidate, managed: false }
        }
    }
    return null
}

/** Spawning the CLI costs ~300ms, so don't re-ask on every readiness probe. */
const authCache = new Map<string, { at: number; value: AuthStatus }>()
const AUTH_TTL_MS = 10_000

async function claudeAuthStatus(file: string, force = false): Promise<AuthStatus> {
    const hit = authCache.get(file)
    if (!force && hit && Date.now() - hit.at < AUTH_TTL_MS) return hit.value
    let value: AuthStatus
    try {
        const proc = Bun.spawn([file, 'auth', 'status', '--json'], { stdout: 'pipe', stderr: 'pipe' })
        const out = await new Response(proc.stdout).text()
        await proc.exited
        value = JSON.parse(out) as AuthStatus
    } catch {
        // Unreadable or non-JSON output means we can't prove a login exists,
        // and guessing "yes" would let a broken config be saved.
        value = { loggedIn: false }
    }
    authCache.set(file, { at: Date.now(), value })
    return value
}

/** Whether the given Claude CLI has a usable login, and whose it is. */
export async function checkClaudeAuth(file: string, force = false): Promise<{ ok: boolean; account?: string }> {
    const status = await claudeAuthStatus(file, force)
    const account = [status.email, status.subscriptionType].filter(Boolean).join(' · ')
    return { ok: status.loggedIn === true, account: account || undefined }
}

/**
 * The in-progress `claude auth login`, held open until the user pastes a code.
 * Structurally typed rather than `Bun.Subprocess` because the client's
 * typecheck reaches these shared server files without Bun's globals.
 */
type LoginProcess = {
    stdin: { write: (s: string) => unknown; flush: () => unknown }
    stdout: unknown
    exited: Promise<number>
    kill: () => void
}
let loginProc: LoginProcess | null = null

/**
 * Start the CLI's own OAuth flow and surface its URL through app state. The
 * CLI opens a browser itself; if that fails the user can visit `authUrl`. It
 * then waits on stdin for a pasted code, which `submitAuthCode` supplies.
 */
export async function beginClaudeSignIn(): Promise<void> {
    const file = SPECS.claudeCli.file
    if (!fs.existsSync(file)) throw new Error('Claude Code is not downloaded yet.')
    cancelClaudeSignIn()

    publish('claudeCli', { status: 'authenticating', authUrl: undefined, awaitingCode: false, error: undefined })

    const proc = Bun.spawn([file, 'auth', 'login', '--claudeai'], {
        stdin: 'pipe',
        stdout: 'pipe',
        stderr: 'pipe',
    })
    loginProc = proc as unknown as LoginProcess

        // Stream stdout so the URL reaches the UI as soon as the CLI prints it,
        // rather than after the process exits.
        ; (async () => {
            let buffered = ''
            try {
                for await (const chunk of proc.stdout as unknown as AsyncIterable<Uint8Array>) {
                    buffered += new TextDecoder().decode(chunk)
                    const url = buffered.match(/https:\/\/\S*oauth\/authorize\S*/)?.[0]
                    if (url && state.dependencies.claudeCli?.authUrl !== url) {
                        publish('claudeCli', { authUrl: url })
                    }
                    if (/Paste code here/i.test(buffered)) {
                        publish('claudeCli', { awaitingCode: true })
                    }
                }
            } catch { /* killed by cancel */ }
        })()

        // When it exits, re-derive the real status rather than trusting the flow.
        ; (async () => {
            await proc.exited
            if (loginProc !== proc) return
            loginProc = null
            authCache.delete(file)
            const status = await verifyDependency('claudeCli').catch(() => 'unauthenticated' as const)
            const account = (await claudeAuthStatus(file, true)).email
            publish('claudeCli', { status, authUrl: undefined, awaitingCode: false, account })
            if (status === 'satisfied') log.server.ok('Signed in to Claude')
        })()
}

/** Feed the browser-provided code to the waiting CLI. */
export function submitAuthCode(code: string): void {
    if (!loginProc) throw new Error('No sign-in is in progress.')
    loginProc.stdin.write(`${code.trim()}\n`)
    loginProc.stdin.flush()
    publish('claudeCli', { awaitingCode: false })
}

export function cancelClaudeSignIn(): void {
    if (!loginProc) return
    const proc = loginProc
    loginProc = null
    try { proc.kill() } catch { /* already gone */ }
}

// ── Verification cache ──────────────────────────────────────────────────────

type CacheEntry = { sha256: string; bytes: number; mtimeMs: number }

function readCache(): Record<string, CacheEntry> {
    try {
        return JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8'))
    } catch {
        return {}
    }
}

function writeCache(cache: Record<string, CacheEntry>): void {
    fs.mkdirSync(path.dirname(CACHE_PATH), { recursive: true })
    fs.writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2))
}

async function hashFile(file: string): Promise<string> {
    const hasher = new Bun.CryptoHasher('sha256')
    // Streamed rather than read whole — the Claude binary is ~228MB.
    for await (const chunk of Bun.file(file).stream()) hasher.update(chunk)
    return hasher.digest('hex')
}

// ── Status ──────────────────────────────────────────────────────────────────

function publish(key: DependencyKey, patch: Partial<DependencyState>): void {
    // refreshDependencies() writes each key in full at startup, so a patch
    // always lands on an existing entry.
    mutate(s => { s.dependencies[key] = { ...state.dependencies[key]!, ...patch } })
}

/**
 * Re-derive a dependency's status from what is actually on disk. Trusts the
 * verification cache only when size and mtime still match what was verified;
 * anything else gets re-hashed.
 */
export async function verifyDependency(key: DependencyKey): Promise<DependencyState['status']> {
    const spec = SPECS[key]

    // A system-installed CLI satisfies this without a download. Checked before
    // the hash comparison below, since that pins our own build and a user's
    // (legitimately different) version would fail it.
    if (key === 'claudeCli') {
        const found = resolveClaudeCli()
        if (!found) return 'missing'
        if (!found.managed) {
            return (await checkClaudeAuth(found.file)).ok ? 'satisfied' : 'unauthenticated'
        }
    }

    if (!fs.existsSync(spec.file)) return 'missing'

    // An unpacked tree can't be verified by hashing its sentinel — the pinned
    // hash belongs to the archive. The marker written at extraction time is the
    // record that this tree came from those exact bytes.
    if (spec.unpack) {
        const marker = markerPath(key, spec.unpack.dir)
        if (!fs.existsSync(marker)) return 'corrupt'
        const stamped = fs.readFileSync(marker, 'utf-8').trim()
        let expectedArchive: string
        try {
            expectedArchive = (await spec.resolve()).expected.sha256
        } catch {
            // Offline: a tree that was verified once stays verified.
            return await gateReady(spec, 'satisfied')
        }
        return stamped === expectedArchive ? await gateReady(spec, 'satisfied') : 'corrupt'
    }

    const stat = fs.statSync(spec.file)
    const cached = readCache()[key]
    if (cached && cached.bytes === stat.size && cached.mtimeMs === stat.mtimeMs) {
        return await gateReady(spec, 'satisfied')
    }

    // No usable cache entry — hash it. An expected value we can't reach the
    // network for shouldn't demote a file that was verified before, so fall
    // back to the cached hash when resolve() fails.
    let expected: Expected
    try {
        expected = (await spec.resolve()).expected
    } catch (err) {
        if (!cached) throw err
        expected = { sha256: cached.sha256, bytes: cached.bytes }
    }

    if (stat.size !== expected.bytes) return 'corrupt'
    const actual = await hashFile(spec.file)
    if (actual !== expected.sha256) return 'corrupt'

    const cache = readCache()
    cache[key] = { sha256: actual, bytes: stat.size, mtimeMs: stat.mtimeMs }
    writeCache(cache)
    return await gateReady(spec, 'satisfied')
}

/**
 * Apply a spec's extra readiness gate. Bytes being correct is necessary but not
 * always sufficient — a verified Claude CLI that nobody has signed into is
 * 'unauthenticated', which the patcher resolves with a sign-in rather than a
 * download.
 */
async function gateReady(spec: Spec, verified: 'satisfied'): Promise<DependencyState['status']> {
    if (!spec.ready) return verified
    return (await spec.ready(spec.file)).ok ? verified : 'unauthenticated'
}

/** Whether a dependency is usable right now, without downloading anything. */
export async function isSatisfied(key: DependencyKey): Promise<boolean> {
    try {
        return (await verifyDependency(key)) === 'satisfied'
    } catch {
        return false
    }
}

/** Absolute path to a verified dependency, or null if it isn't usable. */
export async function dependencyPath(key: DependencyKey): Promise<string | null> {
    if (!(await isSatisfied(key))) return null
    // May be a system install rather than the path in SPECS.
    if (key === 'claudeCli') return resolveClaudeCli()?.file ?? null
    return SPECS[key].file
}

/** Re-check everything against disk. Called once at startup. */
export async function refreshDependencies(): Promise<void> {
    for (const key of Object.keys(SPECS) as DependencyKey[]) {
        const meta = DEPENDENCIES[key]
        let status: DependencyState['status'] = 'missing'
        let account: string | undefined
        try {
            status = await verifyDependency(key)
            if (key === 'claudeCli' && status !== 'missing') {
                account = (await checkClaudeAuth(SPECS.claudeCli.file)).account
            }
        } catch (err) {
            log.server.warn(`Could not verify ${key}: ${err instanceof Error ? err.message : err}`)
        }
        mutate(s => { s.dependencies[key] = { key, label: meta.label, reason: meta.reason, status, account } })
    }
}

// ── Download ────────────────────────────────────────────────────────────────

const inFlight = new Map<DependencyKey, Promise<void>>()

/**
 * Download and verify a dependency, publishing progress into app state so the
 * patcher UI can render it. Idempotent: satisfied dependencies return
 * immediately, and concurrent callers share one download.
 */
/**
 * Unpack a verified zip into `dir`, flattening it.
 *
 * The archives are flat already — upstream zips `build/bin/*` — so any nested
 * path is unexpected, and taking only the basename means a crafted entry can't
 * escape `dir`. Directory entries carry no bytes and are skipped.
 */
function extractZip(archive: Buffer, dir: string): void {
    const files = unzipSync(new Uint8Array(archive))
    for (const [entry, bytes] of Object.entries(files)) {
        if (entry.endsWith('/') || bytes.byteLength === 0) continue
        const name = entry.split(/[\/]/).pop()
        if (!name) continue
        fs.writeFileSync(path.join(dir, name), bytes)
    }
}

/** Records which archive produced an unpacked tree, so it can be re-verified. */
function markerPath(key: DependencyKey, dir: string): string {
    return path.join(dir, `.${key}.sha256`)
}

/**
 * Stream a response to disk, hashing as it goes, and report progress.
 *
 * Streaming rather than buffering because these run to gigabytes: the diffusion
 * model alone is 2.2 GB, and collecting chunks into an array before
 * `Buffer.concat` would need roughly twice that in RAM at the moment of
 * concatenation. Hashing incrementally means the bytes are never all resident.
 */
export async function downloadResumable(
    url: string,
    dest: string,
    expectedBytes: number,
    onProgress: (received: number, total: number | undefined) => void,
): Promise<string> {
    // Bytes already on disk from an attempt that was killed rather than failed.
    let have = fs.existsSync(dest) ? fs.statSync(dest).size : 0
    // A partial at or past the full size is not a partial — it is junk from a
    // different build of the file. Start over rather than trying to salvage it.
    if (have >= expectedBytes) { fs.rmSync(dest, { force: true }); have = 0 }

    let res = await fetch(url, {
        redirect: 'follow',
        headers: have > 0 ? { Range: `bytes=${have}-` } : {},
    })

    // 416: the range is past the end of what the server now has, which means
    // the partial belongs to a file that no longer exists upstream. Left alone
    // this would resend the same impossible range on every retry and never
    // recover, so the bytes are dropped and the whole file re-requested once.
    if (res.status === 416 && have > 0) {
        log.server.warn('Server rejected the resume range; discarding the partial file and restarting')
        fs.rmSync(dest, { force: true })
        have = 0
        res = await fetch(url, { redirect: 'follow' })
    }

    if (!res.ok || !res.body) throw new Error(`${res.status} ${res.statusText}`)

    // A resume counts only if the server said 206 *and* the range it sent
    // starts exactly where we asked. A 200, a CDN that ignores Range, or a
    // Content-Range at some other offset all mean the body is not a
    // continuation — so the kept bytes are worthless and the file restarts.
    // Without the offset check a mismatched range would be appended blindly and
    // silently corrupt the result.
    let resuming = have > 0 && res.status === 206
    if (resuming) {
        const start = Number(/bytes\s+(\d+)-/.exec(res.headers.get('content-range') ?? '')?.[1])
        if (!Number.isFinite(start) || start !== have) {
            log.server.warn(`Resume offset mismatch (asked ${have}, got ${res.headers.get('content-range')}); restarting`)
            resuming = false
        }
    }
    if (have > 0 && !resuming) have = 0

    const hasher = new Bun.CryptoHasher('sha256')
    if (resuming) {
        // The hash covers the whole file, so the kept prefix has to go through
        // the hasher too. A disk read, not a network one — the point of the
        // exercise is not re-fetching gigabytes.
        const fd = fs.openSync(dest, 'r')
        try {
            const buf = Buffer.allocUnsafe(4 * 1024 * 1024)
            for (let off = 0; off < have;) {
                const n = fs.readSync(fd, buf, 0, Math.min(buf.length, have - off), off)
                if (n <= 0) break
                hasher.update(buf.subarray(0, n))
                off += n
            }
        } finally { fs.closeSync(fd) }
        log.server.info(`Resuming download at ${(have / 1048576).toFixed(0)}MB`)
    }

    const remaining = Number(res.headers.get('content-length') ?? 0) || undefined
    const total = remaining ? have + remaining : expectedBytes || undefined

    const handle = fs.openSync(dest, resuming ? 'a' : 'w')
    let received = have
    let lastStep = -1
    try {
        onProgress(received, total)
        for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
            hasher.update(chunk)
            fs.writeSync(handle, chunk)
            received += chunk.byteLength
            // Throttled to 1% (or 2MB with no known length) — all the bar can
            // render, and 3GB in 64KB chunks would otherwise emit tens of
            // thousands of socket patches.
            const step = total ? Math.floor((received / total) * 100) : Math.floor(received / 2_000_000)
            if (step !== lastStep) { lastStep = step; onProgress(received, total) }
        }
    } finally {
        fs.closeSync(handle)
    }
    return hasher.digest('hex')
}

export function ensureDependency(key: DependencyKey): Promise<void> {
    const existing = inFlight.get(key)
    if (existing) return existing

    const run = (async () => {
        if (await isSatisfied(key)) {
            publish(key, { status: 'satisfied', error: undefined })
            return
        }

        const spec = SPECS[key]
        publish(key, { status: 'downloading', received: 0, total: undefined, error: undefined })

        try {
            const { url, expected, compressed } = await spec.resolve()
            fs.mkdirSync(path.dirname(spec.file), { recursive: true })

            const res = await fetch(url, { redirect: 'follow' })
            if (!res.ok || !res.body) throw new Error(`${res.status} ${res.statusText}`)

            // Compressed artifacts report their own (smaller) length, so drive
            // the bar off whatever this transfer actually sends.
            const total = Number(res.headers.get('content-length') ?? 0) || undefined
            publish(key, { total })

            const partial = `${spec.file}.partial`
            let actual: string

            if (compressed === 'zstd') {
                // The pinned hash is of the *decompressed* payload, so the whole
                // artifact has to be resident to inflate it. Only the Claude CLI
                // takes this path (~52MB); everything larger streams.
                const chunks: Uint8Array[] = []
                let received = 0
                let lastStep = 0
                for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
                    chunks.push(chunk)
                    received += chunk.byteLength
                    const step = total ? Math.floor((received / total) * 100) : Math.floor(received / 2_000_000)
                    if (step !== lastStep) { lastStep = step; publish(key, { received }) }
                }
                publish(key, { received: total ?? received })
                const bytes = Buffer.from(Bun.zstdDecompressSync(Buffer.concat(chunks)))
                actual = new Bun.CryptoHasher('sha256').update(bytes).digest('hex')
                if (actual !== expected.sha256) {
                    throw new Error(`checksum mismatch (expected ${expected.sha256.slice(0, 12)}…, got ${actual.slice(0, 12)}…)`)
                }
                fs.writeFileSync(partial, bytes)
            } else {
                actual = await downloadResumable(url, partial, expected.bytes, (received, seen) => {
                    publish(key, { received, ...(seen ? { total: seen } : {}) })
                })
                // Verify BEFORE moving into place, so a bad download never
                // becomes a file that later looks present.
                if (actual !== expected.sha256) {
                    // Poisoned rather than merely incomplete: resuming onto these
                    // bytes would fail forever. This is the one case worth
                    // discarding, so drop it and let a retry start clean.
                    fs.rmSync(partial, { force: true })
                    throw new Error(`checksum mismatch (expected ${expected.sha256.slice(0, 12)}…, got ${actual.slice(0, 12)}…)`)
                }
            }

            if (spec.unpack) {
                fs.mkdirSync(spec.unpack.dir, { recursive: true })
                extractZip(fs.readFileSync(partial), spec.unpack.dir)
                fs.rmSync(partial, { force: true })
                fs.writeFileSync(markerPath(key, spec.unpack.dir), actual)
                if (spec.executable && process.platform !== 'win32') fs.chmodSync(spec.file, 0o755)
            } else {
                fs.renameSync(partial, spec.file)
                if (spec.executable && process.platform !== 'win32') fs.chmodSync(spec.file, 0o755)
            }

            const stat = fs.statSync(spec.file)
            const cache = readCache()
            cache[key] = { sha256: actual, bytes: stat.size, mtimeMs: stat.mtimeMs }
            writeCache(cache)

            // Re-derive rather than assuming 'satisfied': a freshly downloaded
            // Claude CLI is still unusable until someone signs in.
            const status = await gateReady(spec, 'satisfied')
            publish(key, { status, received: stat.size, total: stat.size, error: undefined })
            log.server.ok(`Dependency downloaded: ${DEPENDENCIES[key].label}${status === 'satisfied' ? '' : ' (sign-in required)'}`)
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err)
            // The partial is deliberately KEPT. A dropped connection three
            // quarters of the way through 2.2GB should cost the last quarter,
            // not the whole thing — `downloadResumable` continues from whatever
            // is on disk. The only bytes worth throwing away are ones that
            // failed the hash, which is handled where that is detected.
            publish(key, { status: 'failed', error: message })
            log.server.error(`Dependency ${key} failed: ${message}`)
        }
    })().finally(() => inFlight.delete(key))

    inFlight.set(key, run)
    return run
}

/** Clear a failed dependency so the patcher stops blocking the UI. */
export async function dismissDependency(key: DependencyKey): Promise<void> {
    if (state.dependencies[key]?.status !== 'failed') return
    publish(key, { status: await verifyDependency(key).catch(() => 'missing' as const), error: undefined })
}
