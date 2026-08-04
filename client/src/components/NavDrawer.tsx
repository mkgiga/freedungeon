import { For } from 'solid-js'
import { activeTab, setActiveTab, type Tab } from '../tab-state'
import { useDrawer } from './Drawer'
import { NAV_ITEMS } from './nav-items'
import { Text } from './typography/Text'

export function NavDrawer() {
    const drawer = useDrawer()

    const go = (tab: Tab) => {
        setActiveTab(tab)
        drawer.close()
    }

    return (
        <menu class="nav-drawer">
            <For each={NAV_ITEMS}>
                {(item) => (
                    <button type="button" onClick={() => go(item.tab)} classList={{ active: activeTab() === item.tab }}>
                        {item.icon()}
                        <Text>{item.label}</Text>
                    </button>
                )}
            </For>
        </menu>
    )
}
