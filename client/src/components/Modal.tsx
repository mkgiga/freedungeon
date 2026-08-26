import { createSignal, createContext, useContext, For, Show, onMount, onCleanup, type JSXElement } from 'solid-js'
import { Portal } from 'solid-js/web'
import { MdFillClose } from 'solid-icons/md'
import { Heading } from './typography/Heading'

type ModalConfig = {
    title?: string
    content: () => JSXElement
    onClose?: () => void
    closeOnOverlay?: boolean
    closeOnEscape?: boolean
    fullscreen?: boolean
}

type ModalAPI = {
    open: (config: ModalConfig) => void
    close: () => void
}

const ModalContext = createContext<ModalAPI>()

export function useModal(): ModalAPI {
    const ctx = useContext(ModalContext)
    if (!ctx) throw new Error('useModal must be used within <ModalProvider>')
    return ctx
}

export function ModalProvider(props: { children: JSXElement }) {
    const [stack, setStack] = createSignal<ModalConfig[]>([])
    const top = () => stack()[stack().length - 1]

    const close = () => {
        top()?.onClose?.()
        setStack(s => s.slice(0, -1))
    }

    const push = (config: ModalConfig) => setStack(s => [...s, config])

    const api: ModalAPI = {
        open: (config) => push({
            closeOnOverlay: true,
            closeOnEscape: true,
            ...config,
        }),
        close,
    }

    const handleKeydown = (e: KeyboardEvent) => {
        if (e.key === 'Escape' && top()?.closeOnEscape) close()
    }

    onMount(() => document.addEventListener('keydown', handleKeydown))
    onCleanup(() => document.removeEventListener('keydown', handleKeydown))

    return (
        <ModalContext.Provider value={api}>
            {props.children}
            <For each={stack()}>
                {(modal) => (
                    <Portal>
                        <div
                            class="modal-overlay"
                            onMouseDown={(e) => {
                                if (e.target === e.currentTarget) {
                                    (e.currentTarget as any).__clickedOverlay = true
                                }
                            }}
                            onMouseUp={(e) => {
                                if (e.target === e.currentTarget && (e.currentTarget as any).__clickedOverlay && modal.closeOnOverlay) {
                                    close()
                                }
                                (e.currentTarget as any).__clickedOverlay = false
                            }}
                        >
                            <div class={`modal-container ${modal.fullscreen ? 'modal-fullscreen' : ''}`}>
                                <Show when={modal.title}>
                                    <div class="modal-header">
                                        <Heading level={2}>{modal.title}</Heading>
                                        <button class="modal-close" onClick={close}><MdFillClose size={16} /></button>
                                    </div>
                                </Show>
                                <div class="modal-body">
                                    {modal.content()}
                                </div>
                            </div>
                        </div>
                    </Portal>
                )}
            </For>
        </ModalContext.Provider>
    )
}
