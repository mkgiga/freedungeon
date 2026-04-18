import { createSignal, createContext, useContext, Show, onMount, onCleanup, type JSXElement } from 'solid-js'
import { Portal } from 'solid-js/web'
import { MdFillClose } from 'solid-icons/md'
import { Heading } from './typography/Heading'

// ── Types ──

type BottomSheetConfig = {
    title?: string
    content: () => JSXElement
    onClose?: () => void
    closeOnOverlay?: boolean
    closeOnEscape?: boolean
    showHandle?: boolean
    maxHeight?: string
}

type BottomSheetAPI = {
    open: (config: BottomSheetConfig) => void
    close: () => void
}

// ── Context ──

const BottomSheetContext = createContext<BottomSheetAPI>()

export function useBottomSheet(): BottomSheetAPI {
    const ctx = useContext(BottomSheetContext)
    if (!ctx) throw new Error('useBottomSheet must be used within <BottomSheetProvider>')
    return ctx
}

// ── Provider ──

export function BottomSheetProvider(props: { children: JSXElement }) {
    const [current, setCurrent] = createSignal<BottomSheetConfig | null>(null)

    const close = () => {
        const sheet = current()
        sheet?.onClose?.()
        setCurrent(null)
    }

    const api: BottomSheetAPI = {
        open: (config) => setCurrent({
            closeOnOverlay: true,
            closeOnEscape: true,
            showHandle: true,
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
        <BottomSheetContext.Provider value={api}>
            {props.children}
            <Show when={current()}>
                {(sheet) => (
                    <Portal>
                        <div
                            class="bottom-sheet-overlay"
                            onMouseDown={(e) => {
                                if (e.target === e.currentTarget) {
                                    (e.currentTarget as any).__clickedOverlay = true
                                }
                            }}
                            onMouseUp={(e) => {
                                if (e.target === e.currentTarget && (e.currentTarget as any).__clickedOverlay && sheet().closeOnOverlay) {
                                    close()
                                }
                                (e.currentTarget as any).__clickedOverlay = false
                            }}
                        >
                            <div
                                class="bottom-sheet-container"
                                style={sheet().maxHeight ? { 'max-height': sheet().maxHeight } : undefined}
                            >
                                <Show when={sheet().showHandle}>
                                    <div class="bottom-sheet-handle" />
                                </Show>
                                <Show when={sheet().title}>
                                    <div class="bottom-sheet-header">
                                        <Heading level={2}>{sheet().title}</Heading>
                                        <button class="modal-close" onClick={close}><MdFillClose size={16} /></button>
                                    </div>
                                </Show>
                                <div class="bottom-sheet-body">
                                    {sheet().content()}
                                </div>
                            </div>
                        </div>
                    </Portal>
                )}
            </Show>
        </BottomSheetContext.Provider>
    )
}
