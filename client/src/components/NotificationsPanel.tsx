import { createResource, createSignal, For, Show } from 'solid-js'
import { MdFillNotifications } from 'solid-icons/md'
import { state } from '../state'
import { trpc } from '../trpc'
import { registerPanel } from '../panels'
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
 * Register the panel once, for the app's lifetime.
 *
 * Unlike Downloads this is always present: the log exists whether or not
 * anything is happening, and a notifications button that comes and goes would
 * be a worse place to look than one that is simply always there.
 */
export function registerNotificationsPanel(onAction: (a: NotificationAction) => void): () => void {
    return registerPanel({
        id: 'notifications',
        label: 'Notifications',
        icon: (size = 24) => <MdFillNotifications size={size} />,
        badge: () => (unseenCount() > 0 ? unseenCount() : null),
        order: 10,
        render: () => <NotificationsPanel onAction={onAction} />,
    })
}
