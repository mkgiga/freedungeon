import { For, Show } from 'solid-js'
import { MdFillSettings, MdFillSmart_toy } from 'solid-icons/md'
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
import { useSystemMenu } from './SystemMenu'

/**
 * On tablet the label leaves the DOM rather than being hidden with CSS, so
 * screen readers and find-in-page can't reach it. `title` carries the name.
 */
export function LeftNav() {
    const pickers = useAssetPickers()
    const configs = useLlmConfigs()
    const preferences = usePreferences()
    const systemMenu = useSystemMenu()
    const help = useHelp()
    const showLabels = () => viewport() === 'wide'

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
            <button
                type="button"
                class="left-nav-preferences"
                title="Menu"
                onClick={systemMenu.open}
            >
                <span class="nav-badge-anchor">
                    <MdFillSettings size={26} />
                    <Show when={systemMenu.unseen() > 0}>
                        <span class="nav-badge">{systemMenu.unseen()}</span>
                    </Show>
                </span>
                <Show when={showLabels()}>
                    <Text>Menu</Text>
                </Show>
            </button>
        </menu>
    )
}
