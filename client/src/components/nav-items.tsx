import type { JSXElement } from 'solid-js'
import { MdFillAuto_stories, MdFillChat, MdFillHouse, MdFillNote, MdFillPerson, MdFillSettings } from 'solid-icons/md'
import type { Tab } from '../tab-state'

/**
 * The app's destinations, in nav order. Shared so BottomNav, LeftNav and
 * NavDrawer can't drift apart on which tabs exist or what they're called.
 */
export const NAV_ITEMS: { tab: Tab; label: string; icon: (size?: number) => JSXElement }[] = [
    { tab: 'home', label: 'Home', icon: (size = 24) => <MdFillHouse size={size} /> },
    { tab: 'scenarios', label: 'Scenarios', icon: (size = 24) => <MdFillAuto_stories size={size} /> },
    { tab: 'actors', label: 'Actors', icon: (size = 24) => <MdFillPerson size={size} /> },
    { tab: 'chat', label: 'Chat', icon: (size = 24) => <MdFillChat size={size} /> },
    { tab: 'notes', label: 'Notes', icon: (size = 24) => <MdFillNote size={size} /> },
    { tab: 'preferences', label: 'Preferences', icon: (size = 24) => <MdFillSettings size={size} /> },
]
