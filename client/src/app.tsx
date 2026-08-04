import { For } from 'solid-js'
import { createRouter, createMemoryHistory, RouterProvider } from '@tanstack/solid-router'
import { MetaProvider } from '@solidjs/meta'
import { routeTree } from './routeTree.gen'
import { ModalProvider } from './components/Modal'
import { DrawerProvider } from './components/Drawer'
import { BottomSheetProvider } from './components/BottomSheet'
import { ToastProvider } from './components/Toast'
import { BottomNav } from './components/BottomNav'
import { PatcherOverlay } from './components/PatcherOverlay'
import { OnboardingOverlay } from './components/OnboardingOverlay'
import { LeftNav } from './components/LeftNav'
import { ShowOn } from './components/ShowOn'
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
                    <BottomSheetProvider>
                        <ToastProvider>
                            {/* Row wrapper: the side rail sits beside the content,
                                where the bottom bar sat under it. */}
                            <div class="app-body">
                                <ShowOn viewport={['tablet', 'wide']}>
                                    <LeftNav />
                                </ShowOn>
                                <main>
                                    <For each={TABS}>
                                        {(tab) => (
                                            <div class="tab-pane" classList={{ hidden: activeTab() !== tab }}>
                                                <RouterProvider router={routers[tab]} />
                                            </div>
                                        )}
                                    </For>
                                </main>
                            </div>
                            {/* One nav at a time — the rail replaces the bar rather
                                than doubling up on the same five destinations. */}
                            <ShowOn viewport="phone">
                                <BottomNav activeTab={activeTab()} onChange={setActiveTab} />
                            </ShowOn>
                            {/* Outside the tab panes so they block every tab, not just the active
                                one. Patcher is mounted last so it layers above onboarding —
                                choosing Anthropic during setup starts a download that has to
                                stay visible. */}
                            <OnboardingOverlay />
                            <PatcherOverlay />
                        </ToastProvider>
                    </BottomSheetProvider>
                </DrawerProvider>
            </ModalProvider>
        </MetaProvider>
    )
}
