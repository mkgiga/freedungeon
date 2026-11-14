import { state } from '../../../state'

/**
 * Mirrors `isIconPending`: the job lives in `activities`, which is never
 * persisted, so a spinner cannot outlive the render that owns it.
 */
export function isImagePending(messageId: string): boolean {
    return Object.values(state.activities ?? {}).some(
        a => a.kind === 'generatingImage' && (a.data as { messageId?: string }).messageId === messageId,
    )
}
