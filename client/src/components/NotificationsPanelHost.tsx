import { onCleanup } from 'solid-js'
import { registerNotificationsPanel } from './NotificationsPanel'
import { useNotificationActions } from '../notification-actions'

/**
 * Registers the Notifications panel for the app's lifetime.
 *
 * A component rather than a module-level call because the action handler needs
 * `useLlmConfigs`, which is a context — so registration has to happen inside
 * the provider tree. Renders nothing itself; the panel body is drawn by
 * PanelHost when it's the open one.
 */
export function NotificationsPanelHost() {
    onCleanup(registerNotificationsPanel(useNotificationActions()))
    return null
}
