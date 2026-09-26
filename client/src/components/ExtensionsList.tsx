import { createSignal, For, Show } from 'solid-js'
import { MdFillArchive, MdFillError, MdFillRefresh } from 'solid-icons/md'
import { state } from '../state'
import { trpc } from '../trpc'
import { Text } from './typography/Text'
import { SettingsToggle } from './settings'
import { SchemaForm } from './json-ui'
import { ExtensionSlot } from '../extensions/ExtensionSlot'
import { useImageGenConsent } from './ImageGenConsent'
import { resolveExtensionConfig, type ExtensionInfo } from '@shared/extensions'

const IMAGE_GENERATION_ID = 'core.imageGeneration'

/**
 * Built-ins and dropped-in folders in one list, sorted with the app's own
 * first. They are the same kind of thing and behave the same way; the only
 * difference the UI draws is that a built-in has nothing to uninstall.
 */
export function ExtensionsList() {
    const [busy, setBusy] = createSignal<string | null>(null)
    const [failure, setFailure] = createSignal<{ id: string; message: string } | null>(null)
    const confirmImageGen = useImageGenConsent()

    const items = (): ExtensionInfo[] =>
        Object.values(state.extensions ?? {}).sort((a, b) =>
            Number(b.builtIn) - Number(a.builtIn)
            || a.manifest.name.localeCompare(b.manifest.name))

    const config = (info: ExtensionInfo) =>
        resolveExtensionConfig(info.settings, state.userPreferences.extensions?.[info.manifest.id])

    const toggle = async (info: ExtensionInfo, enabled: boolean) => {
        const id = info.manifest.id
        if (id === IMAGE_GENERATION_ID && enabled && !(await confirmImageGen())) return

        setFailure(null)
        setBusy(id)
        try {
            await trpc.extensions.setEnabled.mutate({ id, enabled })
        } catch (err) {
            setFailure({ id, message: err instanceof Error ? err.message : String(err) })
        } finally {
            setBusy(null)
        }
    }

    const saveSettings = async (info: ExtensionInfo, values: Record<string, unknown>) => {
        const id = info.manifest.id
        setFailure(null)
        try {
            await trpc.extensions.setSettings.mutate({ id, values })
        } catch (err) {
            setFailure({ id, message: err instanceof Error ? err.message : String(err) })
        }
    }

    const uninstall = async (info: ExtensionInfo) => {
        setBusy(info.manifest.id)
        try { await trpc.extensions.uninstall.mutate({ id: info.manifest.id }) }
        finally { setBusy(null) }
    }

    const problem = (info: ExtensionInfo) =>
        failure()?.id === info.manifest.id ? failure()!.message : info.error

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

            <For each={items()}>
                {(info) => (
                    <div
                        class="extension-row"
                        classList={{
                            'is-rejected': info.status === 'invalid',
                            'is-failed': info.status === 'failed' || failure()?.id === info.manifest.id,
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
                                label={info.manifest.name}
                                hint={info.manifest.description}
                                checked={config(info).enabled}
                                disabled={busy() === info.manifest.id}
                                onChange={(on) => toggle(info, on)}
                            />
                        </Show>

                        <Show when={problem(info)}>
                            {(err) => (
                                <div class="extension-error">
                                    <MdFillError size={16} />
                                    <Text size="sm">{err()}</Text>
                                </div>
                            )}
                        </Show>

                        <Show when={info.status === 'active'}>
                            <div class="extension-body">
                                <Show when={info.settings.length > 0}>
                                    <SchemaForm
                                        fields={info.settings}
                                        values={config(info).values}
                                        onChange={(values) => saveSettings(info, values)}
                                    />
                                </Show>
                                <ExtensionSlot name="settings.extension" only={info.manifest.id} />
                            </div>
                        </Show>

                        <div class="extension-row-footer">
                            <Text size="sm" class="settings-hint">
                                {info.builtIn ? 'Built in' : info.manifest.id}
                                <Show when={!info.builtIn && info.manifest.author}>{(a) => <> · {a()}</>}</Show>
                                <> · {info.manifest.version}</>
                            </Text>
                            <Show when={!info.builtIn}>
                                <button
                                    type="button"
                                    class="settings-inline-btn"
                                    disabled={busy() === info.manifest.id}
                                    onClick={() => uninstall(info)}
                                >
                                    {info.status === 'invalid' ? 'Remove' : 'Uninstall'}
                                </button>
                            </Show>
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
