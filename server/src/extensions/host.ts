import fs from 'node:fs'
import path from 'node:path'
import { nanoid } from 'nanoid'
import { unzipSync } from 'fflate'
import { DATA_DIR } from '../paths'
import { log } from '../logger'
import { state, mutate } from '../server'
import { notification } from '../notifications'
import { extensionStore } from '../extension-state'
import { clearExtensionState } from '../db'
import { CurrentChat } from '../chat'
import { execCommand } from '../agent'
import { beginActivity, endActivity, updateActivity, withActivity } from '../activity'
import { beginHold, endHold, holdWhile, releaseHoldsOf } from './holds'
import { parseBlocks, serializeBlocks } from '@shared/blocks'
import {
    backgroundEntry,
    isCoreId,
    resolveExtensionConfig,
    validateManifest,
    type ExtensionConfig,
    type ExtensionInfo,
    type ExtensionManifest,
} from '@shared/extensions'
import type { SchemaField } from '@shared/schema-ui'
import type { ChatMessage } from '@shared/types'
import { BUILTIN_EXTENSIONS } from './builtin'
import {
    closeContributions,
    contributionsOf,
    isExtensionActive,
    notifySettingsChange,
    openContributions,
    scopeOwner,
} from './registry'
import type { ExtensionModule, FreedungeonHost } from './sdk'

const EXTENSIONS_DIR = path.join(DATA_DIR, 'extensions')

const loaded = new Map<string, ExtensionModule>()

function storedConfig(id: string): ExtensionConfig | undefined {
    return state.userPreferences.extensions?.[id]
}

/**
 * A required extension is on whether or not anything was ever stored for it, so
 * every existing `extensionEnabled` check keeps working without learning about
 * the flag. `loadExtensions` writes the flag through so the client agrees.
 */
function enabledFlag(id: string): boolean {
    if (state.extensions?.[id]?.required) return true
    return storedConfig(id)?.enabled === true
}

function declaredSettings(id: string): SchemaField[] {
    return contributionsOf(id)?.settings ?? []
}

/** Stored values merged over the running extension's declared defaults. */
export function extensionValues(id: string): Record<string, unknown> {
    return resolveExtensionConfig(declaredSettings(id), storedConfig(id)).values
}

/**
 * Every built-in, then every manifest on disk. Nothing is executed here. An
 * extension whose manifest fails validation is marked `invalid`, skipped by
 * the loader, and refused by `setExtensionEnabled` even if a stale enabled
 * flag survives.
 *
 * It is still listed, with the reason - a dropped-in folder that simply never
 * appears leaves nowhere to look but the log.
 */
export function scanExtensions(): ExtensionInfo[] {
    const found: ExtensionInfo[] = BUILTIN_EXTENSIONS.map(b => ({
        manifest: b.manifest,
        status: 'installed' as const,
        dir: '',
        builtIn: true,
        required: b.required === true,
        settings: [],
    }))

    if (!fs.existsSync(EXTENSIONS_DIR)) return found

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
                status: 'invalid', dir, builtIn: false, required: false, settings: [],
                error: `manifest.json is not valid JSON (${err instanceof Error ? err.message : err})`,
            })
            log.server.warn(`Extension "${entry.name}" rejected: manifest.json is not valid JSON`)
            continue
        }

        const problem = validateManifest(parsed)
        const manifest = parsed as ExtensionManifest
        if (problem) {
            found.push({
                manifest: {
                    ...manifest,
                    id: entry.name,
                    name: manifest?.name ?? entry.name,
                    version: manifest?.version ?? '0',
                    main: manifest?.main ?? '',
                },
                status: 'invalid', dir, builtIn: false, required: false, settings: [], error: problem,
            })
            log.server.warn(`Extension "${entry.name}" rejected: ${problem}`)
            continue
        }
        found.push({ manifest, status: 'installed', dir, builtIn: false, required: false, settings: [] })
    }
    return found
}

function publish(list: ExtensionInfo[]): void {
    mutate(s => { s.extensions = Object.fromEntries(list.map(e => [e.manifest.id, e])) })
}

/** Served path of the browser entry, if the manifest names one. */
function contentUrlOf(manifest: ExtensionManifest): string | undefined {
    if (!manifest.content) return undefined
    return `/extensions/${manifest.id}/${manifest.content.replace(/^\.?\//, '')}`
}

function buildHost(info: ExtensionInfo): FreedungeonHost {
    const id = info.manifest.id
    const prefix = `[ext:${id}]`
    const bag = () => contributionsOf(id)

    /** Registration helper: record it, and hand back the call that undoes it. */
    const revocable = (undo: () => void): (() => void) => {
        let done = false
        return () => { if (!done) { done = true; undo() } }
    }

    return {
        id,
        manifest: info.manifest,
        state: extensionStore(id),

        settings: {
            define(fields) {
                const entry = bag()
                if (entry) entry.settings = fields
            },
            get values() {
                return extensionValues(id)
            },
            get(name, fallback) {
                const value = extensionValues(id)[name]
                return (value === undefined ? fallback : value) as never
            },
            onChange(handler) {
                bag()?.settingsListeners.push(handler)
                return revocable(() => {
                    const list = bag()?.settingsListeners
                    const at = list?.indexOf(handler) ?? -1
                    if (list && at !== -1) list.splice(at, 1)
                })
            },
        },

        app: {
            get state() {
                return state
            },
            update: mutate,
        },

        chat: {
            get id() {
                return state.currentChat.id
            },
            get messages() {
                return state.currentChat.messages
            },
            post(content, opts) {
                const chatId = state.currentChat.id
                if (!chatId) return null
                const now = Date.now()
                const message: ChatMessage = {
                    id: nanoid(),
                    role: opts?.role ?? 'assistant',
                    chatId,
                    content: typeof content === 'string' ? content : serializeBlocks(content),
                    createdAt: now,
                    updatedAt: now,
                    metadata: { extension: id, ...(opts?.metadata ?? {}) },
                }
                return CurrentChat.upsertMessage(message).id
            },
            systemNotice(text) {
                const trimmed = text.trim()
                if (!trimmed) return
                const existing = state.currentChat.pendingSystemNotice.trim()
                mutate(s => {
                    s.currentChat.pendingSystemNotice = existing ? `${existing}\n${trimmed}` : trimmed
                })
            },
            prompt: (message) => CurrentChat.prompt({ message }),
        },

        game: {
            exec(command, args) {
                const chatId = state.currentChat.id
                if (!chatId) return Promise.resolve({ error: 'no_chat_loaded' })
                return execCommand(chatId, command, args)
            },
        },

        blocks: { parse: parseBlocks, serialize: serializeBlocks },

        activity: {
            run: withActivity,
            begin: beginActivity,
            update: updateActivity,
            end: endActivity,
        },

        turn: {
            hold: ((reason: string, fn?: () => Promise<unknown>) => {
                if (fn) return holdWhile(id, reason, fn)

                const holdId = beginHold(id, reason)
                // Also a disposer, so switching the extension off releases a
                // hold it never got around to releasing itself. It drops out of
                // that list once used, or an extension that holds once a turn
                // would accumulate dead disposers for the life of the session.
                const release = revocable(() => {
                    endHold(holdId)
                    const list = bag()?.disposers
                    const at = list?.indexOf(release) ?? -1
                    if (list && at !== -1) list.splice(at, 1)
                })
                bag()?.disposers.push(release)
                return release
            }) as FreedungeonHost['turn']['hold'],
        },

        prompt: {
            section(build) {
                bag()?.sections.push(build)
                return revocable(() => {
                    const list = bag()?.sections
                    const at = list?.indexOf(build) ?? -1
                    if (list && at !== -1) list.splice(at, 1)
                })
            },
            scope(name, build) {
                const owner = scopeOwner(name)
                if (owner && owner !== id) {
                    log.server.warn(`${prefix} macro scope "${name}" is already answered by ${owner}; ignoring`)
                    return () => {}
                }
                bag()?.scopes.set(name, build)
                return revocable(() => { bag()?.scopes.delete(name) })
            },
        },

        on(event, handler) {
            const entry = bag()
            const list = entry?.events.get(event) ?? []
            list.push(handler as (payload: unknown) => void)
            entry?.events.set(event, list)
            return revocable(() => {
                const at = list.indexOf(handler as (payload: unknown) => void)
                if (at !== -1) list.splice(at, 1)
            })
        },

        onCall(name, handler) {
            bag()?.calls.set(name, handler)
            return revocable(() => { bag()?.calls.delete(name) })
        },

        log: (m) => log.server.info(`${prefix} ${m}`),
        warn: (m) => log.server.warn(`${prefix} ${m}`),
        error: (m) => log.server.error(`${prefix} ${m}`),
        notify: ({ title, message, kind }) => notification({
            title, content: message,
            backgroundColor: kind === 'error' ? '#7a1f1f' : '#1f3a7a',
            textColor: '#fff', show: true, toast: true, push: false,
        }),
        onDispose: (fn) => { bag()?.disposers.push(fn) },
    }
}

async function resolveModule(info: ExtensionInfo): Promise<ExtensionModule> {
    const builtIn = BUILTIN_EXTENSIONS.find(b => b.manifest.id === info.manifest.id)
    if (builtIn) return builtIn.module

    const entry = path.join(info.dir, backgroundEntry(info.manifest))
    if (!fs.existsSync(entry)) {
        throw new Error(`entry not found: ${backgroundEntry(info.manifest)}`)
    }
    const mod = await import(`${Bun.pathToFileURL(entry).href}?v=${Date.now()}`)
    return (mod.default ?? mod) as ExtensionModule
}

/**
 * Contributions are opened *before* `activate` runs, so everything the
 * extension registers lands in one bag that a failure can drop whole - a
 * half-activated extension leaves nothing behind.
 */
async function activate(info: ExtensionInfo): Promise<ExtensionInfo> {
    const id = info.manifest.id
    openContributions(id)
    try {
        const module = await resolveModule(info)
        loaded.set(id, module)
        await module.activate?.(buildHost(info))
        log.server.ok(`Extension activated: ${info.manifest.name} (${id})`)
        return {
            ...info,
            status: 'active',
            error: undefined,
            settings: declaredSettings(id),
            contentUrl: contentUrlOf(info.manifest),
        }
    } catch (err) {
        closeContributions(id)
        releaseHoldsOf(id)
        loaded.delete(id)
        const message = err instanceof Error ? err.message : String(err)
        log.server.error(`Extension ${id} failed to activate: ${message}`)
        return { ...info, status: 'failed', error: message, settings: [], contentUrl: undefined }
    }
}

async function deactivate(id: string): Promise<void> {
    const module = loaded.get(id)
    closeContributions(id)
    releaseHoldsOf(id)
    loaded.delete(id)
    if (!module) return
    try { await module.deactivate?.() } catch (err) {
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
        if (isExtensionActive(id)) {
            results.push({
                ...info,
                status: 'active',
                settings: declaredSettings(id),
                contentUrl: contentUrlOf(info.manifest),
            })
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

export async function loadExtensions(): Promise<void> {
    // Written through rather than inferred on read: the client gates on
    // `extensionEnabled(prefs, id)`, which knows nothing about `required`.
    const requiredIds = BUILTIN_EXTENSIONS.filter(b => b.required).map(b => b.manifest.id)
    const unset = requiredIds.filter(id => storedConfig(id)?.enabled !== true)
    if (unset.length > 0) {
        mutate(s => {
            const bag = (s.userPreferences.extensions ??= {})
            for (const id of unset) bag[id] = { enabled: true, values: bag[id]?.values ?? {} }
        })
    }

    const results = await rescanExtensions()
    const active = results.filter(r => r.status === 'active').length
    log.server.info(`Extensions: ${active} active of ${results.length} installed`)
}

export async function shutdownExtensions(): Promise<void> {
    for (const id of [...loaded.keys()]) await deactivate(id)
}

/**
 * Switching on runs `activate`, and an extension that refuses to start says so
 * by throwing: the enabled flag is rolled back and the reason is handed to the
 * caller, rather than leaving a switch that reads on and does nothing.
 */
export async function setExtensionEnabled(id: string, enabled: boolean): Promise<void> {
    const info = state.extensions?.[id]
    if (!info) throw new Error(`No extension "${id}" is installed`)
    if (!enabled && info.required) {
        throw new Error(`${info.manifest.name} is part of the app and can't be switched off.`)
    }
    if (enabled && info.status === 'invalid') {
        throw new Error(info.error ?? 'That extension\'s manifest is unusable.')
    }

    mutate(s => {
        const bag = (s.userPreferences.extensions ??= {})
        bag[id] = { enabled, values: bag[id]?.values ?? {} }
    })

    if (!enabled) {
        await deactivate(id)
        mutate(s => {
            s.extensions[id] = {
                ...info, status: 'installed', error: undefined, settings: [], contentUrl: undefined,
            }
        })
        return
    }

    const next = await activate(info)
    mutate(s => { s.extensions[id] = next })
    if (next.status === 'failed') {
        mutate(s => { s.userPreferences.extensions![id] = { enabled: false, values: storedConfig(id)?.values ?? {} } })
        throw new Error(next.error ?? 'The extension failed to start.')
    }
}

/**
 * Settings listeners run first and may throw to refuse, so a value that the
 * extension cannot honour is never written - the user sees why instead of a
 * setting that reads on and does nothing.
 */
export async function setExtensionSettings(
    id: string,
    patch: Record<string, unknown>,
): Promise<Record<string, unknown>> {
    if (!state.extensions?.[id]) throw new Error(`No extension "${id}" is installed`)

    const prev = extensionValues(id)
    const next = { ...prev, ...patch }
    await notifySettingsChange(id, next, prev)

    mutate(s => {
        const bag = (s.userPreferences.extensions ??= {})
        bag[id] = { enabled: bag[id]?.enabled ?? false, values: next }
    })
    return next
}

/**
 * The zip needs `manifest.json` at its root, or inside a single top-level
 * folder - which is what most archive tools produce.
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
    if (manifest.content && !files[root + manifest.content.replace(/^\.?\//, '')]) {
        throw new Error(`manifest points at "${manifest.content}", which is not in the archive`)
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

    const info: ExtensionInfo = { manifest, status: 'installed', dir, builtIn: false, required: false, settings: [] }
    mutate(s => { s.extensions[manifest.id] = info })
    log.server.ok(`Extension installed: ${manifest.name} (${manifest.id})`)
    return info
}

export async function uninstallExtension(id: string): Promise<void> {
    const info = state.extensions?.[id]
    if (info?.builtIn || isCoreId(id)) {
        throw new Error('Built-in extensions ship with the app and cannot be uninstalled.')
    }
    if (info?.required) {
        throw new Error(`${info.manifest.name} is part of the app and cannot be removed.`)
    }
    await deactivate(id)
    if (info) fs.rmSync(info.dir, { recursive: true, force: true })
    await clearExtensionState(id)
    mutate(s => {
        delete s.extensions[id]
        if (s.userPreferences.extensions) delete s.userPreferences.extensions[id]
    })
    log.server.info(`Extension uninstalled: ${id}`)
}

/**
 * Resolve a request for one of an active extension's own files, for the
 * browser entry and anything it imports. Inactive extensions serve nothing:
 * switching one off must take its code out of the page too.
 */
export function resolveExtensionFile(id: string, rel: string): string | null {
    const info = state.extensions?.[id]
    if (!info || !isExtensionActive(id) || !info.dir) return null

    const segments = safeSegments(normalizeEntry(decodeURIComponent(rel)))
    if (!segments) return null

    const target = path.join(info.dir, ...segments)
    const root = path.resolve(info.dir) + path.sep
    if (!path.resolve(target).startsWith(root)) return null
    if (!fs.existsSync(target) || !fs.statSync(target).isFile()) return null
    return target
}
