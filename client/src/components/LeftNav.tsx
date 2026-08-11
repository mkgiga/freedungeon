import { For, Show } from 'solid-js'
import { MdFillHelp, MdFillSettings, MdFillSmart_toy } from 'solid-icons/md'
import { state } from '../state'
import { activeTab, setActiveTab } from '../tab-state'
import { viewport } from '../viewport'
import { useAssetPickers } from './chat/AssetPicker'
import { useLlmConfigs } from './LlmConfigsDialog'
import { usePreferences } from './PreferencesDialog'
import { useHelp } from './HelpDialog'
import { ImageIcon } from './ImageIcon'
import { NAV_ITEMS } from './nav-items'
import { useAction } from '../actions'
import { Text } from './typography/Text'

/**
 * Side navigation for tablet and widescreen, replacing the bottom bar.
 *
 * On a wide screen each row is an icon plus its label; on a tablet the label is
 * dropped and the rail collapses to icons, keeping horizontal space for the
 * content. The label is omitted from the DOM rather than hidden with CSS so it
 * can't be picked up by screen readers or find-in-page while invisible — the
 * `title` carries the name instead.
 */
export function LeftNav() {
    const pickers = useAssetPickers()
    const configs = useLlmConfigs()
    const preferences = usePreferences()
    const help = useHelp()
    const showLabels = () => viewport() === 'wide'

    // The rail is mounted for the whole desktop session, so it's the natural
    // owner of the two app-wide actions. Both are dialogs — they open over
    // whatever you were doing rather than navigating away from it.
    useAction('app.preferences', preferences.open)
    useAction('app.help', () => help.open())

    const player = () => {
        const id = state.userPreferences.playerCharacterId
        return id ? state.assets.actors?.[id] ?? null : null
    }
    const llmConfig = () => {
        const id = state.userPreferences.activeLLMConfigId
        return id ? state.assets.llmConfigs?.[id] ?? null : null
    }

    return (
        <menu class="left-nav" classList={{ compact: !showLabels() }}>
            {/* Who you are on top, then secondary rows beneath — one line per
                thing the session is currently bound to. On a tablet the rail is
                56px, so every row degrades to just its icon. */}
            <section class="left-nav-header">
                <div class="left-nav-primary">
                    <button
                        type="button"
                        class="left-nav-avatar"
                        classList={{ 'is-empty': !player() }}
                        title={player() ? `Playing as ${player()!.name} — click to change` : 'Choose your character'}
                        onClick={pickers.openPlayerCharacter}
                    >
                        <ImageIcon url={player()?.avatarUrl} size={showLabels() ? 40 : 34} />
                    </button>
                    <Show when={showLabels()}>
                        <div class="left-nav-identity">
                            <Text size="sm" class="left-nav-welcome">Welcome, User.</Text>
                            <Text class="left-nav-character">{player()?.name ?? 'No character'}</Text>
                        </div>
                    </Show>
                </div>

                <div class="left-nav-secondary">
                    <button
                        type="button"
                        class="left-nav-detail"
                        title={llmConfig() ? `Model: ${llmConfig()!.name} — click to change` : 'Choose a model'}
                        onClick={() => configs.open()}
                    >
                        <span class="left-nav-detail-icon"><MdFillSmart_toy size={20} /></span>
                        <Show when={showLabels()}>
                            <Text size="sm" class="left-nav-detail-value">
                                {llmConfig()?.name ?? 'No model'}
                            </Text>
                        </Show>
                    </button>
                </div>
            </section>

            <For each={NAV_ITEMS}>
                {(item) => (
                    <button
                        type="button"
                        title={item.label}
                        onClick={() => setActiveTab(item.tab)}
                        classList={{ active: activeTab() === item.tab }}
                    >
                        {item.icon(26)}
                        <Show when={showLabels()}>
                            <Text>{item.label}</Text>
                        </Show>
                    </button>
                )}
            </For>

            {/* Kept in the rail where it has always been, but it opens a dialog
                rather than switching tabs — so it never costs you the screen you
                were on. Outside NAV_ITEMS because that list is the set of tabs,
                and this is no longer one. */}
            <button
                type="button"
                class="left-nav-preferences"
                title="Preferences"
                onClick={preferences.open}
            >
                <MdFillSettings size={26} />
                <Show when={showLabels()}>
                    <Text>Preferences</Text>
                </Show>
            </button>

            <button
                type="button"
                class="left-nav-preferences"
                title="Help"
                onClick={() => help.open()}
            >
                <MdFillHelp size={26} />
                <Show when={showLabels()}>
                    <Text>Help</Text>
                </Show>
            </button>
        </menu>
    )
}
