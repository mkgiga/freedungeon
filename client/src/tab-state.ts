import { createSignal } from 'solid-js'

export type Tab = 'home' | 'actors' | 'chat' | 'notes' | 'preferences'

export const [activeTab, setActiveTab] = createSignal<Tab>('home')
