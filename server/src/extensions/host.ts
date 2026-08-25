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
 * Read every manifest. Nothing is executed here. An extension whose manifest
 * fails validation is marked `invalid`, skipped by `loadExtensions`, and
 * refused by `setExtensionEnabled` even if a stale enabled flag survives.
 *
 * It is still listed, with the reason - a dropped-in folder that simply never
 * appears leaves nowhere to look but the log.
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

async function activate(info: ExtensionInfo): Promise<ExtensionInfo> {
    const id = info.manifest.id
    const entry = path.join(info.dir, backgroundEntry(info.manifest))
    if (!fs.existsSync(entry)) {
        return { ...info, status: 'failed', error: `entry not found: ${backgroundEntry(info.manifest)}` }
    }

    try {
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
 * Re-read the directory and reconcile against what is running. Used by both
 * startup and Rescan, so a folder dropped in while the server is up behaves as
 * it would have at boot.
 *
 * Running extensions keep `active`; ones whose folder has gone are stopped.
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
    return installFromZipBytes(new Uint8Array(fs.readFileSync(zipPath)))
}

function normalizeEntry(name: string): string {
    return name.split('\\').join('/')
}

function safeSegments(entry: string): string[] | null {
    if (entry.startsWith('/')) return null
    if (/^[a-zA-Z]:/.test(entry)) return null
    const segments = entry.split('/').filter(s => s !== '' && s !== '.')
    if (segments.length === 0) return null
    if (segments.some(s => s === '..')) return null
    return segments
}

/**
 * Same, from bytes — what an upload delivers. A browser hands over a File, not
 * a path, so the drop zone posts the archive rather than naming one.
 */
export async function installFromZipBytes(bytes: Uint8Array): Promise<ExtensionInfo> {
    const files = Object.fromEntries(
        Object.entries(unzipSync(bytes)).map(([name, data]) => [normalizeEntry(name), data]),
    )
    const names = Object.keys(files)

    const manifestKey = names.find(n => n === 'manifest.json')
        ?? names.find(n => n.split('/').length === 2 && n.endsWith('/manifest.json'))
    if (!manifestKey) throw new Error('archive has no manifest.json at its root')
    const root = manifestKey.includes('/') ? manifestKey.slice(0, manifestKey.indexOf('/') + 1) : ''

    const manifest = JSON.parse(new TextDecoder().decode(files[manifestKey]!)) as ExtensionManifest
    const problem = validateManifest(manifest)
    if (problem) throw new Error(`invalid manifest: ${problem}`)

    const dir = path.join(EXTENSIONS_DIR, manifest.id)

    const entryRel = backgroundEntry(manifest)
    if (!files[root + entryRel]) {
        throw new Error(`manifest points at "${entryRel}", which is not in the archive`)
    }
    const planned: { target: string; bytes: Uint8Array }[] = []
    for (const [name, bytes] of Object.entries(files)) {
        if (!name.startsWith(root) || name.endsWith('/')) continue
        const rel = name.slice(root.length)
        const segments = safeSegments(rel)
        if (!segments) throw new Error(`archive entry is not a safe relative path: ${rel}`)
        planned.push({ target: path.join(dir, ...segments), bytes })
    }
    if (planned.length === 0) throw new Error('archive contains no files')

    await deactivate(manifest.id)
    fs.rmSync(dir, { recursive: true, force: true })
    for (const { target, bytes } of planned) {
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
