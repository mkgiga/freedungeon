import { state } from './state'
import { useLlmConfigs } from './components/LlmConfigsDialog'
import { openPanel } from './panels'
import type { NotificationAction } from '@shared/types'

/**
 * Run a notification's fix-it action.
 *
 * Shared by the toast and the notification log so the two can't drift on what
 * a given kind does — the log's whole value is being able to act on something
 * you missed, and that has to behave identically to acting on it live.
 *
 * Targets are resolved here rather than carried on the notification: by the
 * time anyone clicks, the active config may not be the one that was active when
 * the turn failed, and opening a config they are no longer using would be worse
 * than useless. It also means an action stored months ago still points at
 * something real.
 */
export function useNotificationActions() {
    const configs = useLlmConfigs()

    return (action: NotificationAction): void => {
        switch (action.kind) {
            case 'openLlmConfig':
                configs.open(state.userPreferences.activeLLMConfigId ?? undefined)
                return
            case 'openDownloads':
                openPanel('downloads')
                return
        }
    }
}
