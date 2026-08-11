import { createSignal, For, Show } from 'solid-js'
import { MdFillClose } from 'solid-icons/md'
import { state } from '../state'
import { trpc } from '../trpc'
import { Text } from './typography/Text'
import { ACTIONS, conflictsFor, keybindFromEvent, resolveKeybind } from '@shared/actions'
import { featureEnabled, type FeatureKey } from '@shared/features'

/**
 * Rebinding UI for every declared action.
 *
 * Driven entirely off the ACTIONS registry, so a feature that declares a new
 * action gets a row here without touching this file — the same property the
 * feature schemas have in the settings form.
 */
export function KeybindEditor() {
    // Which row is capturing. Only one at a time: a second listener would
    // record the same keypress into two actions.
    const [capturing, setCapturing] = createSignal<string | null>(null)

    // An action belonging to a switched-off feature can't fire, so offering to
    // bind it would be offering something that does nothing.
    const visible = () => Object.values(ACTIONS).filter(
        a => !a.feature || featureEnabled(state.userPreferences, a.feature as FeatureKey),
    )

    const bindingOf = (id: string) => resolveKeybind(id, state.userPreferences.keybinds)

    const save = (id: string, binding: string | null) =>
        trpc.preferences.update.mutate({
            keybinds: { ...state.userPreferences.keybinds, [id]: binding },
        })

    const onCapture = (id: string, e: KeyboardEvent) => {
        e.preventDefault()
        e.stopPropagation()
        // Escape aborts rather than binding itself — it's the one key a capture
        // box has to leave alone if you want a way out of the box.
        if (e.key === 'Escape') { setCapturing(null); return }
        const binding = keybindFromEvent(e)
        if (!binding) return   // a lone modifier; keep listening for the real key
        // Last write wins: whatever previously held this chord is unbound, so
        // two actions can never answer the same keypress.
        const stolen = conflictsFor(binding, state.userPreferences.keybinds, id)
        const next: Record<string, string | null> = { ...state.userPreferences.keybinds, [id]: binding }
        for (const other of stolen) next[other.id] = null
        trpc.preferences.update.mutate({ keybinds: next })
        setCapturing(null)
    }

    return (
        <div class="keybind-list">
            <For each={visible()}>
                {(action) => (
                    <div class="keybind-row">
                        <span class="keybind-text">
                            <Text>{action.label}</Text>
                            <Show when={action.description}>
                                {(d) => <Text size="sm" class="settings-hint">{d()}</Text>}
                            </Show>
                        </span>

                        <button
                            type="button"
                            class="keybind-capture"
                            classList={{ 'is-capturing': capturing() === action.id }}
                            onClick={() => setCapturing(action.id)}
                            onKeyDown={(e) => { if (capturing() === action.id) onCapture(action.id, e) }}
                            onBlur={() => { if (capturing() === action.id) setCapturing(null) }}
                            title="Click, then press a key combination"
                        >
                            <Show
                                when={capturing() !== action.id}
                                fallback={<Text size="sm">Press a key…</Text>}
                            >
                                <Show
                                    when={bindingOf(action.id)}
                                    fallback={<Text size="sm" class="settings-hint">Unbound</Text>}
                                >
                                    {(b) => <kbd class="keybind-key">{b()}</kbd>}
                                </Show>
                            </Show>
                        </button>

                        <button
                            type="button"
                            class="settings-icon-btn keybind-clear"
                            title="Unbind"
                            disabled={!bindingOf(action.id)}
                            onClick={() => save(action.id, null)}
                        >
                            <MdFillClose size={16} />
                        </button>
                    </div>
                )}
            </For>
        </div>
    )
}
