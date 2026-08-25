import { MdFillChat, MdFillHouse, MdFillNote, MdFillPerson, MdFillSettings } from 'solid-icons/md'
import { For, Show } from 'solid-js'
import type { Tab } from '../tab-state'
import { useSystemMenu } from './SystemMenu'

export type { Tab }

/**
 * The last slot is a dialog, not a tab, so it never shows active. NavDrawer and
 * the Drawer's `side: 'left'` support still work but nothing opens them.
 */
export function BottomNav(props: { activeTab: Tab; onChange: (t: Tab) => void }) {
    const systemMenu = useSystemMenu()
    return (
        <menu id="main-nav">
            <button type="button" onClick={() => props.onChange('home')}   classList={{ active: props.activeTab === 'home' }}>   <MdFillHouse size={32} /></button>
            <button type="button" onClick={() => props.onChange('actors')} classList={{ active: props.activeTab === 'actors' }}> <MdFillPerson size={32} /></button>
            <button type="button" onClick={() => props.onChange('chat')}   classList={{ active: props.activeTab === 'chat' }}>   <MdFillChat size={32} /></button>
            <button type="button" onClick={() => props.onChange('notes')}  classList={{ active: props.activeTab === 'notes' }}>  <MdFillNote size={32} /></button>
            <button type="button" class="nav-badge-anchor" onClick={systemMenu.open} title="Menu">
                <MdFillSettings size={32} />
                <Show when={systemMenu.unseen() > 0}>
                    <span class="nav-badge">{systemMenu.unseen()}</span>
                </Show>
            </button>
        </menu>
    )
}
