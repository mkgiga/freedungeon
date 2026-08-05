import { createSignal, createContext, useContext, For, Show, onMount, onCleanup, type JSXElement } from 'solid-js'
import { Portal } from 'solid-js/web'
import { MdFillClose } from 'solid-icons/md'
import { Heading } from './typography/Heading'
import { Text } from './typography/Text'

// ── Types ──

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
    confirm: (opts: { title?: string; message: string; onConfirm: () => void; onCancel?: () => void }) => void
}

// ── Context ──

const ModalContext = createContext<ModalAPI>()

export function useModal(): ModalAPI {
    const ctx = useContext(ModalContext)
    if (!ctx) throw new Error('useModal must be used within <ModalProvider>')
    return ctx
}

// ── Provider ──

export function ModalProvider(props: { children: JSXElement }) {
    // A stack, not a single slot: a modal can open another one (the actor
    // editor opens Add Expression), and replacing it would unmount the editor
    // along with its unsaved draft. Every entry stays mounted; only the top one
    // is reachable, since each overlay covers the whole viewport.
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
        confirm: (opts) => {
            push({
                title: opts.title ?? 'Confirm',
                closeOnOverlay: true,
                closeOnEscape: true,
                content: () => (
                    <div class="modal-confirm">
                        <Text>{opts.message}</Text>
                        <div class="modal-confirm-actions">
                            <button class="modal-btn modal-btn-cancel" onClick={() => { opts.onCancel?.(); close() }}>Cancel</button>
                            <button class="modal-btn modal-btn-confirm" onClick={() => { opts.onConfirm(); close() }}>Confirm</button>
                        </div>
                    </div>
                ),
            })
        },
    }

    const handleKeydown = (e: KeyboardEvent) => {
        if (e.key === 'Escape' && top()?.closeOnEscape) close()
    }

    onMount(() => document.addEventListener('keydown', handleKeydown))
    onCleanup(() => document.removeEventListener('keydown', handleKeydown))

    return (
        <ModalContext.Provider value={api}>
            {props.children}
            {/* For, not Show: entries below the top must stay mounted so their
                state survives the one above them being opened and closed. */}
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
