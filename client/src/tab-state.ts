import { createSignal } from 'solid-js'

export type Tab = 'home' | 'scenarios' | 'actors' | 'chat' | 'notes' | 'preferences'

export const [activeTab, setActiveTab] = createSignal<Tab>('home')

/**
 * Which of the two things the chat tab is showing. It lives here rather than
 * inside /chat because switching to the tab isn't always enough — playing a
 * Scenario has to land on the conversation it just created, not on whatever
 * the tab happened to be showing last.
 */
export type ChatView = 'list' | 'conversation'

export const [chatView, setChatView] = createSignal<ChatView>('list')
