import fs from 'node:fs'
import path from 'node:path'
import { unzipSync } from 'fflate'
import { DATA_DIR } from '../paths'
import { log } from '../logger'
import { state, mutate } from '../server'
import { notification } from '../notifications'
import { extensionStore } from '../extension-state'
import { clearExtensionState } from '../db'
import {
    backgroundEntry,
    validateManifest,
    type ExtensionInfo,
    type ExtensionManifest,
} from '@shared/extensions'
import type { ExtensionModule, FreedungeonHost } from './sdk'

/**
 * Loads, activates and tears down extensions.
 *
 * An extension is a directory under `~/.freedungeon/extensions/<id>/` holding a
 * `manifest.json` and its source. No build step: the runtime transpiles the
 * author's TypeScript on import, resolves their relative imports, and resolves
 * bare specifiers against a `node_modules/` they ship alongside — all of which
 * works identically inside the compiled binary, because that binary embeds the
 * whole Bun runtime.
 *
 * Extensions run with the same reach as the rest of the server. That is a
 * deliberate choice, not an oversight: installing one is trusting it, the same
 * way installing anything else is.
 */
const EXTENSIONS_DIR = path.join(DATA_DIR, 'extensions')

type Loaded = {
    module: ExtensionModule
    disposers: (() => void)[]
}

const loaded = new Map<string, Loaded>()

function enabledFlag(id: string): boolean {
    return state.userPreferences.extensions?.[id]?.enabled === true
}

/**
 * Read every manifest. Nothing is executed here, and an extension whose
 * manifest doesn't validate is never executed at all: it is marked `invalid`,
 * `loadExtensions` skips it, and `setExtensionEnabled` refuses it even if a
 * stale enabled flag survives from before the file was broken.
 *
 * It is still *listed*, with the reason. A folder the user just dropped in that
 * simply fails to appear is the worst version of this — they have nowhere to
 * look but a log they have no reason to open, so the rejection is shown where
 * the extension would have been.
 */
export function scanExtensions(): ExtensionInfo[] {
    if (!fs.existsSync(EXTENSIONS_DIR)) return []
    const found: ExtensionInfo[] = []

    for (const entry of fs.readdirSync(EXTENSIONS_DIR, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue
        const dir = path.join(EXTENSIONS_DIR, entry.name)
        const manifestPath = path.join(dir, 'manifest.json')
        if (!fs.existsSync(manifestPath)) continue

        let parsed: unknown
        try {
            parsed = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
        } catch (err) {
            found.push({
                manifest: { id: entry.name, name: entry.name, version: '0', main: '' },
                status: 'invalid', dir,
                error: `manifest.json is not valid JSON (${err instanceof Error ? err.message : err})`,
            })
            log.server.warn(`Extension "${entry.name}" rejected: manifest.json is not valid JSON`)
            continue
        }

        const problem = validateManifest(parsed)
        const manifest = parsed as ExtensionManifest
        if (problem) {
            // Keyed by the FOLDER, not by whatever id the broken manifest
            // claims: an unusable manifest's id is not to be trusted, and two
            // of them claiming the same one would collapse into a single row —
            // hiding one of the two things the user actually has to go fix.
            found.push({
                manifest: { ...manifest, id: entry.name, name: manifest?.name ?? entry.name, version: manifest?.version ?? '0', main: manifest?.main ?? '' },
                status: 'invalid', dir, error: problem,
            })
            log.server.warn(`Extension "${entry.name}" rejected: ${problem}`)
            continue
        }
        found.push({ manifest, status: 'installed', dir })
    }
    return found
}

/** Publish the current list into app state so the UI can render it. */
function publish(list: ExtensionInfo[]): void {
    mutate(s => { s.extensions = Object.fromEntries(list.map(e => [e.manifest.id, e])) })
}

function buildHost(info: ExtensionInfo, disposers: (() => void)[]): FreedungeonHost {
    const id = info.manifest.id
    const prefix = `[ext:${id}]`
    return {
        id,
        manifest: info.manifest,
        state: extensionStore(id),
        log: (m) => log.server.info(`${prefix} ${m}`),
        warn: (m) => log.server.warn(`${prefix} ${m}`),
        error: (m) => log.server.error(`${prefix} ${m}`),
        notify: ({ title, message, kind }) => notification({
            title, content: message,
            backgroundColor: kind === 'error' ? '#7a1f1f' : '#1f3a7a',
            textColor: '#fff', show: true, toast: true, push: false,
        }),
        onDispose: (fn) => { disposers.push(fn) },
    }
}

/**
 * Import and activate one extension.
 *
 * A throwing extension is recorded as `failed` and otherwise ignored: one bad
 * plugin must not take the server down or prevent the others from loading.
 */
async function activate(info: ExtensionInfo): Promise<ExtensionInfo> {
    const id = info.manifest.id
    const entry = path.join(info.dir, backgroundEntry(info.manifest))
    if (!fs.existsSync(entry)) {
        return { ...info, status: 'failed', error: `entry not found: ${backgroundEntry(info.manifest)}` }
    }

    try {
        // Cache-busted so a reload after an edit actually re-reads the file
        // rather than handing back the module already in the registry.
        const mod = await import(`${Bun.pathToFileURL(entry).href}?v=${Date.now()}`)
        const module: ExtensionModule = mod.default ?? mod
        const disposers: (() => void)[] = []
        await module.activate?.(buildHost(info, disposers))
        loaded.set(id, { module, disposers })
        log.server.ok(`Extension activated: ${info.manifest.name} (${id})`)
        return { ...info, status: 'active', error: undefined }
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        log.server.error(`Extension ${id} failed to activate: ${message}`)
        return { ...info, status: 'failed', error: message }
    }
}

/** Run an extension's teardown, tolerating one that throws. */
async function deactivate(id: string): Promise<void> {
    const entry = loaded.get(id)
    if (!entry) return
    loaded.delete(id)
    for (const dispose of entry.disposers.reverse()) {
        try { dispose() } catch (err) { log.server.warn(`[ext:${id}] disposer threw: ${err}`) }
    }
    try { await entry.module.deactivate?.() } catch (err) {
        log.server.warn(`[ext:${id}] deactivate threw: ${err}`)
    }
}

/**
 * Re-read the directory and reconcile against what is running.
 *
 * This is what both startup and the Rescan button use, so a folder dropped in
 * while the server is up behaves exactly as it would have at boot: discovered,
 * and started if it was already enabled. Anything already running keeps its
 * `active` status rather than being reported back as merely installed, and
 * anything whose folder has disappeared is stopped rather than left running
 * against files that no longer exist.
 */
export async function rescanExtensions(): Promise<ExtensionInfo[]> {
    fs.mkdirSync(EXTENSIONS_DIR, { recursive: true })
    const found = scanExtensions()
    const results: ExtensionInfo[] = []

    for (const info of found) {
        const id = info.manifest.id
        if (loaded.has(id)) {
            results.push({ ...info, status: 'active' })
            continue
        }
        results.push(info.status === 'installed' && enabledFlag(id) ? await activate(info) : info)
    }

    // Folder deleted out from under a running extension.
    for (const id of [...loaded.keys()]) {
        if (!found.some(f => f.manifest.id === id)) {
            log.server.warn(`Extension ${id} disappeared from disk; stopping it`)
            await deactivate(id)
        }
    }

    publish(results)
    return results
}

/** Scan, then activate everything currently enabled. Called once at startup. */
export async function loadExtensions(): Promise<void> {
    const results = await rescanExtensions()
    const active = results.filter(r => r.status === 'active').length
    if (results.length) log.server.info(`Extensions: ${active} active of ${results.length} installed`)
}

/** Turn one on or off, applying it immediately rather than at next boot. */
export async function setExtensionEnabled(id: string, enabled: boolean): Promise<void> {
    mutate(s => {
        const bag = (s.userPreferences.extensions ??= {})
        bag[id] = { enabled }
    })

    const info = state.extensions?.[id]
    if (!info) return
    if (enabled) {
        if (info.status === 'invalid') return
        const next = await activate(info)
        mutate(s => { s.extensions[id] = next })
    } else {
        await deactivate(id)
        mutate(s => { s.extensions[id] = { ...info, status: 'installed', error: undefined } })
    }
}

/**
 * Install from a zip containing `manifest.json` at its root (or inside a single
 * top-level folder, which is what most archive tools produce).
 */
export async function installFromZip(zipPath: string): Promise<ExtensionInfo> {
    const files = unzipSync(new Uint8Array(fs.readFileSync(zipPath)))
    const names = Object.keys(files)

    const manifestKey = names.find(n => n === 'manifest.json')
        ?? names.find(n => n.split('/').length === 2 && n.endsWith('/manifest.json'))
    if (!manifestKey) throw new Error('archive has no manifest.json at its root')
    const root = manifestKey.includes('/') ? manifestKey.slice(0, manifestKey.indexOf('/') + 1) : ''

    const manifest = JSON.parse(new TextDecoder().decode(files[manifestKey]!)) as ExtensionManifest
    const problem = validateManifest(manifest)
    if (problem) throw new Error(`invalid manifest: ${problem}`)

    // Unpacked under the id, not the archive name, so reinstalling the same
    // extension replaces it instead of accumulating copies.
    const dir = path.join(EXTENSIONS_DIR, manifest.id)
    await deactivate(manifest.id)
    fs.rmSync(dir, { recursive: true, force: true })

    for (const [name, bytes] of Object.entries(files)) {
        if (!name.startsWith(root) || name.endsWith('/')) continue
        const rel = name.slice(root.length)
        // A zip entry may name any path it likes; refuse anything that would
        // land outside the extension's own directory.
        const target = path.resolve(dir, rel)
        if (!target.startsWith(path.resolve(dir) + path.sep)) {
            throw new Error(`archive entry escapes its directory: ${rel}`)
        }
        fs.mkdirSync(path.dirname(target), { recursive: true })
        fs.writeFileSync(target, bytes)
    }

    const info: ExtensionInfo = { manifest, status: 'installed', dir }
    mutate(s => { s.extensions[manifest.id] = info })
    log.server.ok(`Extension installed: ${manifest.name} (${manifest.id})`)
    return info
}

/** Deactivate, delete the folder, and drop the extension's stored state. */
export async function uninstallExtension(id: string): Promise<void> {
    await deactivate(id)
    const info = state.extensions?.[id]
    if (info) fs.rmSync(info.dir, { recursive: true, force: true })
    await clearExtensionState(id)
    mutate(s => {
        delete s.extensions[id]
        if (s.userPreferences.extensions) delete s.userPreferences.extensions[id]
    })
    log.server.info(`Extension uninstalled: ${id}`)
}
