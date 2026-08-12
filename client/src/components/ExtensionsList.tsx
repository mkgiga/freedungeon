import { createSignal, For, Show } from 'solid-js'
import { MdFillRefresh, MdFillError } from 'solid-icons/md'
import { state } from '../state'
import { trpc } from '../trpc'
import { Text } from './typography/Text'
import { SettingsToggle } from './settings'
import type { ExtensionInfo } from '@shared/extensions'

/**
 * Installed extensions, with a switch each.
 *
 * The list comes from replicated state rather than a query — the server scans
 * the extensions directory and publishes what it found, so this only issues
 * verbs. An extension is only *executed* once switched on; until then this is
 * showing manifests, which is the whole reason identity lives in a file
 * separate from the code.
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
            <div class="flex items-center justify-between">
                <Text size="sm" class="settings-hint">
                    Drop a folder into <code>~/.freedungeon/extensions</code>, then rescan.
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
                        {/* A rejected extension gets no switch at all. A disabled
                            checkbox says "off, but you could turn it on"; this one
                            cannot be turned on, so showing one would be a lie. */}
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

                        {/* Why it can't load, next to the extension — not only in
                            a log the user has no reason to open. */}
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
