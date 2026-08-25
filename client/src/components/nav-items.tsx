import type { JSXElement } from 'solid-js'
import { MdFillAuto_stories, MdFillChat, MdFillHouse, MdFillNote, MdFillPerson } from 'solid-icons/md'
import type { Tab } from '../tab-state'

export const NAV_ITEMS: { tab: Tab; label: string; icon: (size?: number) => JSXElement }[] = [
    { tab: 'home', label: 'Home', icon: (size = 24) => <MdFillHouse size={size} /> },
    { tab: 'scenarios', label: 'Scenarios', icon: (size = 24) => <MdFillAuto_stories size={size} /> },
    { tab: 'actors', label: 'Actors', icon: (size = 24) => <MdFillPerson size={size} /> },
    { tab: 'chat', label: 'Chat', icon: (size = 24) => <MdFillChat size={size} /> },
    { tab: 'notes', label: 'Notes', icon: (size = 24) => <MdFillNote size={size} /> },
]
