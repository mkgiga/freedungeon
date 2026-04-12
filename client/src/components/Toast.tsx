import { createSignal, createContext, useContext, For, onMount, type JSXElement } from 'solid-js'
import { Portal } from 'solid-js/web'
import { onNotification } from '../state'

// ── Types ──

type ToastType = 'info' | 'success' | 'error' | 'warning'

type ToastConfig = {
    title?: string
    message: string
    type?: ToastType
    duration?: number
    backgroundColor?: string
    textColor?: string
}

type ToastEntry = ToastConfig & {
    id: string
    exiting: boolean
}

type ToastAPI = {
    (config: ToastConfig): string
    success: (message: string, title?: string) => string
    error: (message: string, title?: string) => string
    info: (message: string, title?: string) => string
    warning: (message: string, title?: string) => string
    dismiss: (id: string) => void
}

// ── Context ──

const ToastContext = createContext<ToastAPI>()

export function useToast(): ToastAPI {
    const ctx = useContext(ToastContext)
    if (!ctx) throw new Error('useToast must be used within <ToastProvider>')
    return ctx
}

// ── Provider ──

let nextId = 0

export function ToastProvider(props: { children: JSXElement }) {
    const [toasts, setToasts] = createSignal<ToastEntry[]>([])

    const dismiss = (id: string) => {
        setToasts((prev) => prev.map((t) => t.id === id ? { ...t, exiting: true } : t))
        setTimeout(() => {
            setToasts((prev) => prev.filter((t) => t.id !== id))
        }, 300)
    }

    const show = (config: ToastConfig): string => {
        const id = `toast-${++nextId}`
        const duration = config.duration ?? 4000
        const entry: ToastEntry = { ...config, id, exiting: false }

        setToasts((prev) => [...prev, entry])

        if (duration > 0) {
            setTimeout(() => dismiss(id), duration)
        }

        return id
    }

    onMount(() => {
        onNotification((notification) => {
            if (notification.toast) {
                show({
                    title: notification.title,
                    message: notification.content,
                    backgroundColor: notification.backgroundColor || undefined,
                    textColor: notification.textColor || undefined,
                })
            }
        })
    })

    const api = Object.assign(show, {
        success: (message: string, title?: string) => show({ message, title, type: 'success' }),
        error: (message: string, title?: string) => show({ message, title, type: 'error', duration: 6000 }),
        info: (message: string, title?: string) => show({ message, title, type: 'info' }),
        warning: (message: string, title?: string) => show({ message, title, type: 'warning', duration: 5000 }),
        dismiss,
    }) as ToastAPI

    return (
        <ToastContext.Provider value={api}>
            {props.children}
            <Portal>
                <div class="toast-container">
                    <For each={toasts()}>
                        {(toast) => (
                            <div
                                class={`toast toast-${toast.type ?? 'info'} ${toast.exiting ? 'toast-exit' : 'toast-enter'}`}
                                style={{
                                    ...(toast.backgroundColor ? { 'background-color': toast.backgroundColor } : {}),
                                    ...(toast.textColor ? { color: toast.textColor } : {}),
                                }}
                                onClick={() => dismiss(toast.id)}
                            >
                                {toast.title && <div class="toast-title">{toast.title}</div>}
                                <div class="toast-message">{toast.message}</div>
                            </div>
                        )}
                    </For>
                </div>
            </Portal>
        </ToastContext.Provider>
    )
}
