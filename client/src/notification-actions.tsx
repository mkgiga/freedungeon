import { state } from './state'
import { useLlmConfigs } from './components/LlmConfigsDialog'
import { useDownloads } from './components/PatcherOverlay'
import type { NotificationAction } from '@shared/types'

/**
 * Targets resolve at click time rather than being carried on the notification -
 * the active config may have changed since it was raised.
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
