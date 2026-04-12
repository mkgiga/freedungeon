import { For } from 'solid-js'
import { createRouter, createMemoryHistory, RouterProvider } from '@tanstack/solid-router'
import { MetaProvider } from '@solidjs/meta'
import { routeTree } from './routeTree.gen'
import { ModalProvider } from './components/Modal'
import { DrawerProvider } from './components/Drawer'
import { ToastProvider } from './components/Toast'
import { BottomNav } from './components/BottomNav'
import { activeTab, setActiveTab, type Tab } from './tab-state'

const TAB_INITIAL: Record<Tab, string> = {
    home: '/',
    actors: '/actors',
    chat: '/chat',
    notes: '/notes',
    preferences: '/preferences',
}

function makeTabRouter(tab: Tab) {
    return createRouter({
        routeTree,
        history: createMemoryHistory({ initialEntries: [TAB_INITIAL[tab]] }),
        defaultPreload: 'intent',
        defaultPreloadStaleTime: 0,
    })
}

declare module '@tanstack/solid-router' {
    interface Register {
        router: ReturnType<typeof makeTabRouter>
    }
}

const TABS: Tab[] = ['home', 'actors', 'chat', 'notes', 'preferences']

export function App() {
    const routers: Record<Tab, ReturnType<typeof makeTabRouter>> = {
        home: makeTabRouter('home'),
        actors: makeTabRouter('actors'),
        chat: makeTabRouter('chat'),
        notes: makeTabRouter('notes'),
        preferences: makeTabRouter('preferences'),
    }

    return (
        <MetaProvider>
            <ModalProvider>
                <DrawerProvider>
                    <ToastProvider>
                        <main>
                            <For each={TABS}>
                                {(tab) => (
                                    <div class="tab-pane" classList={{ hidden: activeTab() !== tab }}>
                                        <RouterProvider router={routers[tab]} />
                                    </div>
                                )}
                            </For>
                        </main>
                        <BottomNav activeTab={activeTab()} onChange={setActiveTab} />
                    </ToastProvider>
                </DrawerProvider>
            </ModalProvider>
        </MetaProvider>
    )
}
