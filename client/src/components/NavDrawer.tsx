import { For, type JSXElement } from 'solid-js'
import { MdFillChat, MdFillHouse, MdFillNote, MdFillPerson, MdFillSettings } from 'solid-icons/md'
import { activeTab, setActiveTab, type Tab } from '../tab-state'
import { useDrawer } from './Drawer'
import { Text } from './typography/Text'

const ITEMS: { tab: Tab; label: string; icon: () => JSXElement }[] = [
    { tab: 'home', label: 'Home', icon: () => <MdFillHouse size={24} /> },
    { tab: 'actors', label: 'Actors', icon: () => <MdFillPerson size={24} /> },
    { tab: 'chat', label: 'Chat', icon: () => <MdFillChat size={24} /> },
    { tab: 'notes', label: 'Notes', icon: () => <MdFillNote size={24} /> },
    { tab: 'preferences', label: 'Preferences', icon: () => <MdFillSettings size={24} /> },
]

export function NavDrawer() {
    const drawer = useDrawer()

    const go = (tab: Tab) => {
        setActiveTab(tab)
        drawer.close()
    }

    return (
        <menu class="nav-drawer">
            <For each={ITEMS}>
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
