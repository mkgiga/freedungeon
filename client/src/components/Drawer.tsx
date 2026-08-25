import { createSignal, createContext, useContext, Show, onMount, onCleanup, type JSXElement } from 'solid-js'
import { Portal } from 'solid-js/web'

type DrawerConfig = {
    title?: string
    content: () => JSXElement
    onClose?: () => void
    closeOnOverlay?: boolean
    closeOnEscape?: boolean
    width?: string
    side?: 'left' | 'right'
}

type DrawerAPI = {
    open: (config: DrawerConfig) => void
    close: () => void
}

const DrawerContext = createContext<DrawerAPI>()

export function useDrawer(): DrawerAPI {
    const ctx = useContext(DrawerContext)
    if (!ctx) throw new Error('useDrawer must be used within <DrawerProvider>')
    return ctx
}

export function DrawerProvider(props: { children: JSXElement }) {
    const [current, setCurrent] = createSignal<DrawerConfig | null>(null)

    const close = () => {
        const drawer = current()
        drawer?.onClose?.()
        setCurrent(null)
    }

    const api: DrawerAPI = {
        open: (config) => setCurrent({
            closeOnOverlay: true,
            closeOnEscape: true,
            side: 'right',
            ...config,
        }),
        close,
    }

    const handleKeydown = (e: KeyboardEvent) => {
        if (e.key === 'Escape' && current()?.closeOnEscape) close()
    }

    onMount(() => document.addEventListener('keydown', handleKeydown))
    onCleanup(() => document.removeEventListener('keydown', handleKeydown))

    return (
        <DrawerContext.Provider value={api}>
            {props.children}
            <Show when={current()}>
                {(drawer) => (
                    <Portal>
                        <div
                            class="drawer-overlay"
                            classList={{ left: drawer().side === 'left' }}
                            onMouseDown={(e) => {
                                if (e.target === e.currentTarget) {
                                    (e.currentTarget as any).__clickedOverlay = true
                                }
                            }}
                            onMouseUp={(e) => {
                                if (e.target === e.currentTarget && (e.currentTarget as any).__clickedOverlay && drawer().closeOnOverlay) {
                                    close()
                                }
                                (e.currentTarget as any).__clickedOverlay = false
                            }}
                        >
                            <div
                                class="drawer-container"
                                classList={{ left: drawer().side === 'left' }}
                                style={drawer().width ? { width: drawer().width } : undefined}
                            >
                                {drawer().content()}
                            </div>
                        </div>
                    </Portal>
                )}
            </Show>
        </DrawerContext.Provider>
    )
}
