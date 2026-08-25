import { createSignal } from 'solid-js'

export type Tab = 'home' | 'scenarios' | 'actors' | 'chat' | 'notes'

export const [activeTab, setActiveTab] = createSignal<Tab>('home')

/**
 * Outside /chat because switching to the tab isn't always enough - playing a
 * Scenario has to land on the conversation it just created.
 */
export type ChatView = 'list' | 'conversation'

export const [chatView, setChatView] = createSignal<ChatView>('list')
