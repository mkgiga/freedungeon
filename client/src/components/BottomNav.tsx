import { MdFillChat, MdFillHouse, MdFillNote, MdFillPerson, MdFillSettings } from 'solid-icons/md'
import { For, Show } from 'solid-js'
import type { Tab } from '../tab-state'
import { openPanelId, registeredPanels, togglePanel } from '../panels'
import { usePreferences } from './PreferencesDialog'

export type { Tab }

/**
 * The first slot was briefly a burger opening a left NavDrawer; it's back to
 * Home. NavDrawer and the Drawer's `side: 'left'` support are both intact and
 * still work — nothing currently opens them, so the drawer is simply
 * unreachable rather than removed.
 *
 * The last slot is not a tab: Preferences opens as a dialog over whatever you
 * were doing, so it never has an active state here.
 */
export function BottomNav(props: { activeTab: Tab; onChange: (t: Tab) => void }) {
    const preferences = usePreferences()
    return (
        <menu id="main-nav">
            <button type="button" onClick={() => props.onChange('home')}   classList={{ active: props.activeTab === 'home' }}>   <MdFillHouse size={32} /></button>
            <button type="button" onClick={() => props.onChange('actors')} classList={{ active: props.activeTab === 'actors' }}> <MdFillPerson size={32} /></button>
            <button type="button" onClick={() => props.onChange('chat')}   classList={{ active: props.activeTab === 'chat' }}>   <MdFillChat size={32} /></button>
            <button type="button" onClick={() => props.onChange('notes')}  classList={{ active: props.activeTab === 'notes' }}>  <MdFillNote size={32} /></button>
            <button type="button" onClick={preferences.open}><MdFillSettings size={32} /></button>

            {/* Registered panels append here. This does crowd five slots into
                six or more — accepted because a panel only exists while it has
                something in flight, so the squeeze lasts as long as the work
                does and the bar then returns to normal. */}
            <For each={registeredPanels()}>
                {(panel) => (
                    <button
                        type="button"
                        class="main-nav-panel"
                        classList={{ active: openPanelId() === panel.id }}
                        title={panel.label}
                        onClick={() => togglePanel(panel.id)}
                    >
                        {panel.icon(32)}
                        <Show when={panel.badge?.() != null}>
                            <span class="main-nav-panel-badge">{panel.badge!()}</span>
                        </Show>
                    </button>
                )}
            </For>
        </menu>
    )
}
