import { MdFillChat, MdFillHouse, MdFillNote, MdFillPerson, MdFillSettings } from 'solid-icons/md'

export type Tab = 'home' | 'actors' | 'chat' | 'notes' | 'preferences'

export function BottomNav(props: { activeTab: Tab; onChange: (t: Tab) => void }) {
    return (
        <menu id="main-nav">
            <button type="button" onClick={() => props.onChange('home')}        classList={{ active: props.activeTab === 'home' }}>        <MdFillHouse size={32} /></button>
            <button type="button" onClick={() => props.onChange('actors')}      classList={{ active: props.activeTab === 'actors' }}>      <MdFillPerson size={32} /></button>
            <button type="button" onClick={() => props.onChange('chat')}        classList={{ active: props.activeTab === 'chat' }}>        <MdFillChat size={32} /></button>
            <button type="button" onClick={() => props.onChange('notes')}       classList={{ active: props.activeTab === 'notes' }}>       <MdFillNote size={32} /></button>
            <button type="button" onClick={() => props.onChange('preferences')} classList={{ active: props.activeTab === 'preferences' }}><MdFillSettings size={32} /></button>
        </menu>
    )
}
