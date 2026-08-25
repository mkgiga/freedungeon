import { Show, type JSXElement } from 'solid-js'
import {
    MdFillSettings, MdFillNotifications, MdFillDownload, MdFillHelp, MdFillLogout,
} from 'solid-icons/md'
import { useModal } from './Modal'
import { usePreferences } from './PreferencesDialog'
import { useHelp } from './HelpDialog'
import { unseenCount, useNotifications } from './NotificationsPanel'
import { useDownloads } from './PatcherOverlay'
import { isDesktopApp, quitDesktopApp } from '../desktop'
import { Text } from './typography/Text'

export type SystemMenuEntry = {
    label: string
    icon: JSXElement
    badge?: number
    onClick: () => void
    danger?: boolean
}

/**
 * The settings button as a menu of destinations, the way a game's system menu
 * works, rather than a single shortcut to Preferences.
 *
 * The point is space: Notifications, Downloads and Documentation each need
 * somewhere to live, and none of them deserves a permanent slot in a five-item
 * nav bar. Behind one button they cost nothing until opened, and the pattern is
 * already familiar from the Home dashboard's list of links.
 */
export function useSystemMenu() {
    const modal = useModal()
    const preferences = usePreferences()
    const help = useHelp()
    const notifications = useNotifications()
    const downloads = useDownloads()

    const entries = (): SystemMenuEntry[] => {
        const list: SystemMenuEntry[] = [
            { label: 'Preferences', icon: <MdFillSettings size={22} />, onClick: preferences.open },
            {
                label: 'Notifications',
                icon: <MdFillNotifications size={22} />,
                badge: unseenCount() || undefined,
                onClick: notifications.open,
            },
        ]

        if (downloads.active()) {
            list.push({
                label: `Active downloads${downloads.summary() ? ` — ${downloads.summary()}` : ''}`,
                icon: <MdFillDownload size={22} />,
                onClick: downloads.open,
            })
        }

        list.push({ label: 'Documentation', icon: <MdFillHelp size={22} />, onClick: () => help.open() })

        if (isDesktopApp()) {
            list.push({
                label: 'Quit freedungeon',
                icon: <MdFillLogout size={22} />,
                danger: true,
                onClick: () => void quitDesktopApp(),
            })
        }
        return list
    }

    const open = () => {
        modal.open({
            title: 'freedungeon',
            content: () => (
                <div class="system-menu">
                    {entries().map((entry) => (
                        <button
                            type="button"
                            class="system-menu-item"
                            classList={{ 'is-danger': entry.danger }}
                            onClick={() => { modal.close(); entry.onClick() }}
                        >
                            <span class="system-menu-icon">{entry.icon}</span>
                            <Text class="system-menu-label">{entry.label}</Text>
                            <Show when={entry.badge}>
                                {(count) => <span class="system-menu-badge">{count()}</span>}
                            </Show>
                        </button>
                    ))}
                </div>
            ),
        })
    }

    return { open, unseen: unseenCount }
}
