import { For, Show } from 'solid-js'
import { state } from '../state'
import { activeTab, setActiveTab } from '../tab-state'
import { viewport } from '../viewport'
import { ImageIcon } from './ImageIcon'
import { NAV_ITEMS } from './nav-items'
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
    const showLabels = () => viewport() === 'wide'

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
            {/* On a tablet this collapses to just the avatar — the rail is only
                56px wide, so names and model labels have nowhere to go. */}
            <div class="left-nav-header">
                <div class="left-nav-avatar" classList={{ 'is-empty': !player() }} title={player()?.name ?? 'No character selected'}>
                    <ImageIcon url={player()?.avatarUrl} size={showLabels() ? 40 : 34} />
                </div>
                <Show when={showLabels()}>
                    <div class="left-nav-identity">
                        <Text size="sm" class="left-nav-welcome">Welcome, User.</Text>
                        <Text class="left-nav-character">{player()?.name ?? 'No character'}</Text>
                        <Text size="sm" class="left-nav-model">{llmConfig()?.name ?? 'No model'}</Text>
                    </div>
                </Show>
            </div>

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
        </menu>
    )
}
