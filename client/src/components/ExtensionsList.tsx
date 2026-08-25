import { createSignal, For, Show } from 'solid-js'
import { MdFillArchive, MdFillError, MdFillRefresh } from 'solid-icons/md'
import { state } from '../state'
import { trpc } from '../trpc'
import { Text } from './typography/Text'
import { SettingsToggle } from './settings'
import type { ExtensionInfo } from '@shared/extensions'

/**
 * Installed extensions, with a switch each. The list is replicated state - the
 * server scans the directory and publishes what it found, so this only issues
 * verbs.
 *
 * Nothing is executed until switched on; until then these are manifests.
 */
export function ExtensionsList() {
    const [busy, setBusy] = createSignal<string | null>(null)

    const items = (): ExtensionInfo[] =>
        Object.values(state.extensions ?? {}).sort((a, b) =>
            a.manifest.name.localeCompare(b.manifest.name))

    const toggle = async (info: ExtensionInfo, enabled: boolean) => {
        setBusy(info.manifest.id)
        try { await trpc.extensions.setEnabled.mutate({ id: info.manifest.id, enabled }) }
        finally { setBusy(null) }
    }

    const uninstall = async (info: ExtensionInfo) => {
        setBusy(info.manifest.id)
        try { await trpc.extensions.uninstall.mutate({ id: info.manifest.id }) }
        finally { setBusy(null) }
    }

    return (
        <div class="flex flex-col gap-3">
            <ExtensionDropZone />

            <div class="flex items-center justify-between">
                <Text size="sm" class="settings-hint">
                    Or drop a folder into <code>~/.freedungeon/extensions</code> and rescan.
                </Text>
                <button
                    type="button"
                    class="settings-inline-btn"
                    onClick={() => trpc.extensions.rescan.mutate()}
                    title="Re-read the extensions directory"
                >
                    <MdFillRefresh size={16} /> Rescan
                </button>
            </div>

            <For each={items()} fallback={
                <Text size="sm" class="settings-hint">Nothing installed yet.</Text>
            }>
                {(info) => (
                    <div
                        class="extension-row"
                        classList={{
                            'is-rejected': info.status === 'invalid',
                            'is-failed': info.status === 'failed',
                        }}
                    >
                        <Show
                            when={info.status !== 'invalid'}
                            fallback={
                                <div class="extension-head">
                                    <span class="extension-badge">Rejected</span>
                                    <span class="extension-title">
                                        <Text class="extension-name">{info.manifest.name}</Text>
                                        <Show when={info.manifest.description}>
                                            {(d) => <Text size="sm" class="settings-hint">{d()}</Text>}
                                        </Show>
                                    </span>
                                </div>
                            }
                        >
                            <SettingsToggle
                                label={`${info.manifest.name}  ${info.manifest.version}`}
                                hint={info.manifest.description}
                                checked={info.status === 'active'}
                                disabled={busy() === info.manifest.id}
                                onChange={(on) => toggle(info, on)}
                            />
                        </Show>

                        <Show when={info.error}>
                            {(err) => (
                                <div class="extension-error">
                                    <MdFillError size={16} />
                                    <Text size="sm">{err()}</Text>
                                </div>
                            )}
                        </Show>

                        <div class="extension-row-footer">
                            <Text size="sm" class="settings-hint">
                                {info.manifest.id}
                                <Show when={info.manifest.author}>{(a) => <> · {a()}</>}</Show>
                            </Text>
                            <button
                                type="button"
                                class="settings-inline-btn"
                                disabled={busy() === info.manifest.id}
                                onClick={() => uninstall(info)}
                            >
                                {info.status === 'invalid' ? 'Remove' : 'Uninstall'}
                            </button>
                        </div>
                    </div>
                )}
            </For>
        </div>
    )
}

function ExtensionDropZone() {
    const [over, setOver] = createSignal(false)
    const [busy, setBusy] = createSignal(false)
    const [error, setError] = createSignal<string | null>(null)

    const install = async (file: File | undefined) => {
        if (!file) return
        setError(null)
        setBusy(true)
        try {
            const body = new FormData()
            body.append('file', file)
            const res = await fetch('/extensions', { method: 'POST', body })
            const payload = await res.json().catch(() => ({}))
            if (!res.ok) setError(payload.error ?? 'Could not install that archive.')
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err))
        } finally {
            setBusy(false)
        }
    }

    const browse = () => {
        const input = document.createElement('input')
        input.type = 'file'
        input.accept = '.zip,application/zip'
        input.onchange = () => install(input.files?.[0])
        input.click()
    }

    const carriesFile = (t: DataTransfer | null) =>
        Array.from(t?.items ?? []).some(i => i.kind === 'file')

    return (
        <div class="flex flex-col gap-2">
            <button
                type="button"
                class="extension-dropzone"
                classList={{ 'is-drop-target': over(), 'is-busy': busy() }}
                disabled={busy()}
                onClick={browse}
                onDragOver={(e) => {
                    if (!carriesFile(e.dataTransfer)) return
                    e.preventDefault()
                    setOver(true)
                }}
                onDragLeave={(e) => {
                    const to = e.relatedTarget as Node | null
                    if (to && (e.currentTarget as HTMLElement).contains(to)) return
                    setOver(false)
                }}
                onDrop={(e) => {
                    e.preventDefault()
                    setOver(false)
                    install(Array.from(e.dataTransfer?.files ?? [])[0])
                }}
            >
                <MdFillArchive size={22} class="extension-dropzone-icon" />
                <Text size="sm">
                    {busy() ? 'Installing…' : 'Drop an extension .zip here, or click to browse'}
                </Text>
            </button>

            <Show when={error()}>
                {(e) => (
                    <div class="extension-error">
                        <MdFillError size={16} />
                        <Text size="sm">{e()}</Text>
                    </div>
                )}
            </Show>
        </div>
    )
}
