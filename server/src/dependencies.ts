
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { DEPENDENCIES, type DependencyKey, type DependencyState, type DependencyPlanItem } from '@shared/dependencies'
import { NATIVE_DIR, MODELS_DIR, DATA_DIR } from './paths'
import { unzipSync } from 'fflate'
import { SD_MODELS } from './sd/manifest'
import { SD_DIR, sdArchive, getSdBuildChoice } from './sd/dependency'
import { mutate, state } from './server'
import { log } from './logger'
import claudeManifest from '../../integrations/agent-claude/node_modules/@anthropic-ai/claude-agent-sdk/manifest.json' with { type: 'json' }
import claudeZstManifest from '../../integrations/agent-claude/node_modules/@anthropic-ai/claude-agent-sdk/manifest.zst.json' with { type: 'json' }

const RELEASES = 'https://storage.googleapis.com/claude-code-dist-86c565f3-f756-42ad-8dfa-d59b1c096819/claude-code-releases'

const CACHE_PATH = path.join(DATA_DIR, 'dependencies.json')

type Expected = { sha256: string; bytes: number }

type Spec = {
    file: string
    resolve: () => Promise<{ url: string; expected: Expected; compressed?: 'zstd' }>
    unpack?: { dir: string }
    executable?: boolean
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
        file: path.join(SD_DIR, process.platform === 'win32' ? 'sd-server.exe' : 'sd-server'),
        executable: true,
        unpack: { dir: SD_DIR },
        resolve: async () => sdArchive(0),
    },

    sdCudaRuntime: {
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
            expected: {
                sha256: '9fdfdb41866d872e0acf4a010c35c1a8547bf0eebe0d1544406bbf1c824cb59d',
                bytes: 88217533,
            },
        }),
    },
}

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
    for await (const chunk of Bun.file(file).stream()) hasher.update(chunk)
    return hasher.digest('hex')
}

function publish(key: DependencyKey, patch: Partial<DependencyState>): void {
    mutate(s => { s.dependencies[key] = { ...state.dependencies[key]!, ...patch } })
}

/**
 * Re-derive a dependency's status from what is actually on disk. Trusts the
 * verification cache only when size and mtime still match what was verified;
 * anything else gets re-hashed.
 */
export async function verifyDependency(key: DependencyKey): Promise<DependencyState['status']> {
    const spec = SPECS[key]

    if (key === 'claudeCli') {
        const found = resolveClaudeCli()
        if (!found) return 'missing'
        if (!found.managed) {
            return (await checkClaudeAuth(found.file)).ok ? 'satisfied' : 'unauthenticated'
        }
    }

    if (!fs.existsSync(spec.file)) return 'missing'

    if (spec.unpack) {
        const marker = markerPath(key, spec.unpack.dir)
        if (!fs.existsSync(marker)) return 'corrupt'
        const stamped = fs.readFileSync(marker, 'utf-8').trim()
        let expectedArchive: string
        try {
            expectedArchive = (await spec.resolve()).expected.sha256
        } catch {
            return await gateReady(spec, 'satisfied')
        }
        return stamped === expectedArchive ? await gateReady(spec, 'satisfied') : 'corrupt'
    }

    const stat = fs.statSync(spec.file)
    const cached = readCache()[key]
    if (cached && cached.bytes === stat.size && cached.mtimeMs === stat.mtimeMs) {
        return await gateReady(spec, 'satisfied')
    }

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

async function gateReady(spec: Spec, verified: 'satisfied'): Promise<DependencyState['status']> {
    if (!spec.ready) return verified
    return (await spec.ready(spec.file)).ok ? verified : 'unauthenticated'
}

/**
 * What fetching `keys` would actually cost, so the user can be asked first.
 *
 * Generic on purpose: it reports on whatever keys it is handed, and takes each
 * size from that dependency's own `resolve()`. Nothing here knows which feature
 * asked or which host serves the bytes.
 *
 * `bytes` is what remains, not the file's full size — a dependency half-fetched
 * before the app was closed only owes the rest, and quoting the full figure
 * would overstate the cost and make a resumed download look stalled.
 */
export async function planDependencies(keys: DependencyKey[]): Promise<DependencyPlanItem[]> {
    const items: DependencyPlanItem[] = []
    for (const key of keys) {
        const status = await verifyDependency(key).catch(() => 'missing' as const)
        if (status === 'satisfied') continue

        let bytes = 0
        try {
            const { expected } = await SPECS[key].resolve()
            const partial = `${SPECS[key].file}.partial`
            const have = fs.existsSync(partial) ? fs.statSync(partial).size : 0
            bytes = Math.max(0, expected.bytes - (have < expected.bytes ? have : 0))
        } catch {
            // Unresolvable (an unsupported host, say). Reported with an unknown
            // size rather than omitted — "we need this and can't size it" is
            // information; silently dropping it is not.
        }
        items.push({ key, label: DEPENDENCIES[key].label, reason: DEPENDENCIES[key].reason, status, bytes })
    }
    return items
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
        mutate(s => { s.dependencies[key] = {
            key, label: meta.label, reason: meta.reason, status, account,
            feature: meta.feature,
            required: isRequiredHere(key),
        } })
    }
}

function isRequiredHere(key: DependencyKey): boolean {
    if (key === 'sdCudaRuntime') {
        const choice = getSdBuildChoice()
        return choice?.supported === true && choice.backend === 'cuda12'
    }
    return true
}

const inFlight = new Map<DependencyKey, Promise<void>>()

function extractZip(archive: Buffer, dir: string): void {
    const files = unzipSync(new Uint8Array(archive))
    for (const [entry, bytes] of Object.entries(files)) {
        if (entry.endsWith('/') || bytes.byteLength === 0) continue
        const name = entry.split(/[\/]/).pop()
        if (!name) continue
        fs.writeFileSync(path.join(dir, name), bytes)
    }
}

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
    let have = fs.existsSync(dest) ? fs.statSync(dest).size : 0
    if (have >= expectedBytes) { fs.rmSync(dest, { force: true }); have = 0 }

    let res = await fetch(url, {
        redirect: 'follow',
        headers: have > 0 ? { Range: `bytes=${have}-` } : {},
    })

    if (res.status === 416 && have > 0) {
        log.server.warn('Server rejected the resume range; discarding the partial file and restarting')
        fs.rmSync(dest, { force: true })
        have = 0
        res = await fetch(url, { redirect: 'follow' })
    }

    if (!res.ok || !res.body) throw new Error(`${res.status} ${res.statusText}`)

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

            const total = Number(res.headers.get('content-length') ?? 0) || undefined
            publish(key, { total })

            const partial = `${spec.file}.partial`
            let actual: string

            if (compressed === 'zstd') {
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
                if (actual !== expected.sha256) {
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

            const status = await gateReady(spec, 'satisfied')
            publish(key, { status, received: stat.size, total: stat.size, error: undefined })
            log.server.ok(`Dependency downloaded: ${DEPENDENCIES[key].label}${status === 'satisfied' ? '' : ' (sign-in required)'}`)
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err)
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
