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
import { DEPENDENCIES, type DependencyKey, type DependencyState } from '@shared/dependencies'
import { NATIVE_DIR, MODELS_DIR, DATA_DIR } from './paths'
import { state, setState } from './server'
import { log } from './logger'
// The SDK ships the manifest of the CLI build it expects — version and
// checksum both come from the installed package, so they can't drift apart.
import claudeManifest from '../../agent-claude/node_modules/@anthropic-ai/claude-agent-sdk/manifest.json' with { type: 'json' }
import claudeZstManifest from '../../agent-claude/node_modules/@anthropic-ai/claude-agent-sdk/manifest.zst.json' with { type: 'json' }

const RELEASES = 'https://storage.googleapis.com/claude-code-dist-86c565f3-f756-42ad-8dfa-d59b1c096819/claude-code-releases'

/** Where the verification cache lives, so a satisfied dep boots instantly. */
const CACHE_PATH = path.join(DATA_DIR, 'dependencies.json')

type Expected = { sha256: string; bytes: number }

type Spec = {
    /** Absolute path the verified file ends up at. */
    file: string
    /** Where to fetch it, plus what the bytes must hash to. */
    resolve: () => Promise<{ url: string; expected: Expected; compressed?: 'zstd' }>
    /** Make it runnable once written (no-op on Windows). */
    executable?: boolean
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
    setState('dependencies', key, { ...state.dependencies[key], ...patch })
}

/**
 * Re-derive a dependency's status from what is actually on disk. Trusts the
 * verification cache only when size and mtime still match what was verified;
 * anything else gets re-hashed.
 */
export async function verifyDependency(key: DependencyKey): Promise<DependencyState['status']> {
    const spec = SPECS[key]
    if (!fs.existsSync(spec.file)) return 'missing'

    const stat = fs.statSync(spec.file)
    const cached = readCache()[key]
    if (cached && cached.bytes === stat.size && cached.mtimeMs === stat.mtimeMs) {
        return 'satisfied'
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
    return 'satisfied'
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
    return (await isSatisfied(key)) ? SPECS[key].file : null
}

/** Re-check everything against disk. Called once at startup. */
export async function refreshDependencies(): Promise<void> {
    for (const key of Object.keys(SPECS) as DependencyKey[]) {
        const meta = DEPENDENCIES[key]
        let status: DependencyState['status'] = 'missing'
        try {
            status = await verifyDependency(key)
        } catch (err) {
            log.server.warn(`Could not verify ${key}: ${err instanceof Error ? err.message : err}`)
        }
        setState('dependencies', key, { key, label: meta.label, reason: meta.reason, status })
    }
}

// ── Download ────────────────────────────────────────────────────────────────

const inFlight = new Map<DependencyKey, Promise<void>>()

/**
 * Download and verify a dependency, publishing progress into app state so the
 * patcher UI can render it. Idempotent: satisfied dependencies return
 * immediately, and concurrent callers share one download.
 */
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
            const chunks: Uint8Array[] = []
            let received = 0
            let lastPublished = 0

            for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
                chunks.push(chunk)
                received += chunk.byteLength
                // Throttle: a 52MB download in 64KB chunks would otherwise emit
                // ~800 socket patches. 1% granularity is all the bar can show.
                const step = total ? Math.floor((received / total) * 100) : Math.floor(received / 2_000_000)
                if (step !== lastPublished) {
                    lastPublished = step
                    publish(key, { received })
                }
            }

            let bytes = Buffer.concat(chunks)
            if (compressed === 'zstd') {
                publish(key, { received: total ?? received })
                bytes = Buffer.from(Bun.zstdDecompressSync(bytes))
            }

            // Verify BEFORE publishing to the real path, so a bad download never
            // becomes a file that later looks present.
            const actual = new Bun.CryptoHasher('sha256').update(bytes).digest('hex')
            if (actual !== expected.sha256) {
                throw new Error(`checksum mismatch (expected ${expected.sha256.slice(0, 12)}…, got ${actual.slice(0, 12)}…)`)
            }

            fs.writeFileSync(partial, bytes)
            fs.renameSync(partial, spec.file)
            if (spec.executable && process.platform !== 'win32') fs.chmodSync(spec.file, 0o755)

            const stat = fs.statSync(spec.file)
            const cache = readCache()
            cache[key] = { sha256: actual, bytes: stat.size, mtimeMs: stat.mtimeMs }
            writeCache(cache)

            publish(key, { status: 'satisfied', received: stat.size, total: stat.size, error: undefined })
            log.server.ok(`Dependency ready: ${DEPENDENCIES[key].label}`)
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err)
            // Leave nothing half-written behind for the next attempt to trip on.
            try { fs.rmSync(`${SPECS[key].file}.partial`, { force: true }) } catch { }
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
