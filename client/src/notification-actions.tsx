import { state } from './state'
import { useLlmConfigs } from './components/LlmConfigsDialog'
import { useDownloads } from './components/PatcherOverlay'
import type { NotificationAction } from '@shared/types'

/**
 * Run a notification's fix-it action. Shared by the toast and the log so acting
 * on something you missed behaves the same as acting on it live.
 *
 * Targets resolve at click time rather than being carried on the notification -
 * the active config may have changed since, and an action stored months ago
 * still has to point at something real.
 */
export function useNotificationActions() {
    const configs = useLlmConfigs()
    const downloads = useDownloads()

    return (action: NotificationAction): void => {
        switch (action.kind) {
            case 'openLlmConfig':
                configs.open(state.userPreferences.activeLLMConfigId ?? undefined)
                return
            case 'openDownloads':
                downloads.open()
                return
        }
    }
}
