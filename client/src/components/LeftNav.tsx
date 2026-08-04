import { For, Show } from 'solid-js'
import { activeTab, setActiveTab } from '../tab-state'
import { viewport } from '../viewport'
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

    return (
        <menu class="left-nav" classList={{ compact: !showLabels() }}>
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
