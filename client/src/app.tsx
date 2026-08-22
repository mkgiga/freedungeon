import { For, Show } from 'solid-js'
import { createRouter, createMemoryHistory, RouterProvider } from '@tanstack/solid-router'
import { MetaProvider } from '@solidjs/meta'
import { routeTree } from './routeTree.gen'
import { ModalProvider } from './components/Modal'
import { DrawerProvider } from './components/Drawer'
import { BottomSheetProvider } from './components/BottomSheet'
import { ToastProvider } from './components/Toast'
import { ActionsProvider } from './actions'
import { TooltipProvider } from './components/Tooltip'
import { BottomNav } from './components/BottomNav'
import { PatcherOverlay } from './components/PatcherOverlay'
import { OnboardingOverlay } from './components/OnboardingOverlay'
import { LeftNav } from './components/LeftNav'
import { ShowOn } from './components/ShowOn'
import { activeTab, setActiveTab, chatView, type Tab } from './tab-state'
import { guardStrayImageDrops } from './utils/imageUpload'

const TAB_INITIAL: Record<Tab, string> = {
    home: '/',
    scenarios: '/scenarios',
    actors: '/actors',
    chat: '/chat',
    notes: '/notes',
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

const TABS: Tab[] = ['home', 'scenarios', 'actors', 'chat', 'notes']

// A file dropped anywhere unhandled makes the browser open it, discarding the
// page — including an unsaved editor. Registered once, app-wide.
guardStrayImageDrops()

export function App() {
    const routers: Record<Tab, ReturnType<typeof makeTabRouter>> = {
        home: makeTabRouter('home'),
        scenarios: makeTabRouter('scenarios'),
        actors: makeTabRouter('actors'),
        chat: makeTabRouter('chat'),
        notes: makeTabRouter('notes'),
    }

    return (
        <MetaProvider>
            <ModalProvider>
                <DrawerProvider>
                    <BottomSheetProvider>
                        <ToastProvider>
                         <ActionsProvider>
                          <TooltipProvider>
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
                                than doubling up on the same five destinations.

                                An open conversation gives the bar's height back to
                                the scene: a phone has to fit the feed, the actors
                                band and the composer in one column, and that is the
                                one screen where the height is worth more than the
                                shortcut. Only the conversation, not the chat list —
                                a list has nothing to gain, and its TopBar has no
                                back button, so hiding the nav there would strand
                                you. Here the back button leads out. */}
                            <ShowOn viewport="phone">
                                <Show when={!(activeTab() === 'chat' && chatView() === 'conversation')}>
                                    <BottomNav activeTab={activeTab()} onChange={setActiveTab} />
                                </Show>
                            </ShowOn>
                            {/* Outside the tab panes so they block every tab, not just the active
                                one. Patcher is mounted last so it layers above onboarding —
                                choosing Anthropic during setup starts a download that has to
                                stay visible. */}
                            <OnboardingOverlay />
                            <PatcherOverlay />
                          </TooltipProvider>
                         </ActionsProvider>
                        </ToastProvider>
                    </BottomSheetProvider>
                </DrawerProvider>
            </ModalProvider>
        </MetaProvider>
    )
}
