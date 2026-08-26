import { createSignal, For, onMount, Show, type JSXElement } from 'solid-js'
import { Portal } from 'solid-js/web'
import { onNotification, state } from '../state'
import { useLlmConfigs } from './LlmConfigsDialog'
import { useNotificationActions } from '../notification-actions'
import type { NotificationAction } from '@shared/types'

type ToastType = 'info' | 'success' | 'error' | 'warning'

type ToastConfig = {
    title?: string
    message: string
    type?: ToastType
    duration?: number
    backgroundColor?: string
    textColor?: string
    action?: NotificationAction
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

/**
 * Module scope, not context. There is one toast stack for the whole app, and a
 * context would also have to sit above every caller - which it can't: this
 * provider needs ModalProvider above it (see `runAction`), while modal content
 * needs to raise toasts. Anything rendered through a Portal was unreachable.
 */
const [toasts, setToasts] = createSignal<ToastEntry[]>([])
let nextId = 0

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

const api = Object.assign(show, {
    success: (message: string, title?: string) => show({ message, title, type: 'success' }),
    error: (message: string, title?: string) => show({ message, title, type: 'error', duration: 6000 }),
    info: (message: string, title?: string) => show({ message, title, type: 'info' }),
    warning: (message: string, title?: string) => show({ message, title, type: 'warning', duration: 5000 }),
    dismiss,
}) as ToastAPI

export function useToast(): ToastAPI {
    return api
}

export function ToastProvider(props: { children: JSXElement }) {
    const configs = useLlmConfigs()

    const runAction = useNotificationActions()

    onMount(() => {
        onNotification((notification) => {
            if (notification.toast) {
                show({
                    title: notification.title,
                    message: notification.content,
                    backgroundColor: notification.backgroundColor || undefined,
                    textColor: notification.textColor || undefined,
                    action: notification.action,
                    duration: notification.action ? 0 : undefined,
                })
            }
        })
    })

    return (
        <>
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
                                <Show when={toast.action}>
                                    {(action) => (
                                        <button
                                            type="button"
                                            class="toast-action"
                                            onClick={(e) => {
                                                e.stopPropagation()
                                                runAction(action())
                                                dismiss(toast.id)
                                            }}
                                        >
                                            {action().label}
                                        </button>
                                    )}
                                </Show>
                            </div>
                        )}
                    </For>
                </div>
            </Portal>
        </>
    )
}
