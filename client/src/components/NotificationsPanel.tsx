import { createResource, createSignal, For, Show } from 'solid-js'
import { state } from '../state'
import { trpc } from '../trpc'
import { useModal } from './Modal'
import { useNotificationActions } from '../notification-actions'
import { Text } from './typography/Text'
import { Em } from './typography/Em'
import type { AppNotification, NotificationAction } from '@shared/types'

/** Unseen count, straight off replicated state — no counter to drift. */
export const unseenCount = () => Object.keys(state.notifications ?? {}).length

const when = (ms: number) => {
    const mins = Math.floor((Date.now() - ms) / 60000)
    if (mins < 1) return 'just now'
    if (mins < 60) return `${mins}m ago`
    const hrs = Math.floor(mins / 60)
    if (hrs < 24) return `${hrs}h ago`
    return new Date(ms).toLocaleDateString()
}

/**
 * The notification log.
 *
 * Reads history through `notifications.list` rather than from app state,
 * because the log is unbounded — only the unseen ones are replicated. Opening
 * the panel marks everything seen in one stamp, so the badge clears by being
 * looked at rather than by clicking each row.
 */
export function NotificationsPanel(props: { onAction: (a: NotificationAction) => void }) {
    const [cursor, setCursor] = createSignal<{ createdAt: number; id: string } | undefined>(undefined)
    const [items, setItems] = createSignal<AppNotification[]>([])
    const [done, setDone] = createSignal(false)

    const [initial] = createResource(async () => {
        const page = await trpc.notifications.list.query({ limit: 50 })
        setItems(page)
        setDone(page.length < 50)
        const last = page.at(-1)
        setCursor(last && { createdAt: last.createdAt, id: last.id })
        // Seen on open, not per row — one stamp, and it happens because the
        // list was actually rendered.
        await trpc.notifications.markSeen.mutate()
        return true
    })

    const more = async () => {
        const page = await trpc.notifications.list.query({ limit: 50, before: cursor() })
        setItems((prev) => [...prev, ...page])
        setDone(page.length < 50)
        const last = page.at(-1)
        if (last) setCursor({ createdAt: last.createdAt, id: last.id })
    }

    return (
        <div class="notification-list">
            <Show when={initial.loading}>
                <Text size="sm" class="settings-hint">Loading…</Text>
            </Show>
            <For each={items()} fallback={
                <Show when={!initial.loading}>
                    <Text size="sm" class="settings-hint">Nothing here yet.</Text>
                </Show>
            }>
                {(n) => (
                    <div class="notification-row" style={{ 'border-left-color': n.backgroundColor }}>
                        <div class="notification-row-head">
                            <Text size="sm"><Em semibold>{n.title}</Em></Text>
                            <Text size="sm" class="notification-when">{when(n.createdAt)}</Text>
                        </div>
                        <Text size="sm" class="notification-body">{n.content}</Text>
                        <Show when={n.action}>
                            {(action) => (
                                <button
                                    type="button"
                                    class="settings-inline-btn"
                                    onClick={() => props.onAction(action())}
                                >
                                    {action().label}
                                </button>
                            )}
                        </Show>
                    </div>
                )}
            </For>
            <Show when={items().length > 0 && !done()}>
                <button type="button" class="settings-inline-btn" onClick={more}>Load older</button>
            </Show>
        </div>
    )
}

/**
 * Open the notification log.
 *
 * A dialog, not a side panel. Reading a log is something you go and do and then
 * leave — unlike a download, which you want to glance at while carrying on. And
 * every other entry in the system menu (Preferences, Documentation, the models
 * library) is already a dialog, so this is the shape the app already speaks.
 */
export function useNotifications() {
    const modal = useModal()
    const runAction = useNotificationActions()

    return {
        open: () => modal.open({
            title: 'Notifications',
            content: () => <NotificationsPanel onAction={(a) => { modal.close(); runAction(a) }} />,
        }),
    }
}
