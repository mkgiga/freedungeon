import type { GameStateContext, ItemDefinition } from '@shared/types'
import { state } from '../../../state'

export type ResolvedItem = ItemDefinition

/**
 * Read from `activities`, which is never persisted, so a spinner can't outlive
 * the job. A pending marker on the block would survive a crash and strand the
 * item forever.
 */
export function isIconPending(key: string): boolean {
    return Object.values(state.activities ?? {}).some(
        a => a.kind === 'generatingItemIcon' && (a.data as { key?: string }).key === key,
    )
}

/**
 * Chats predating item definitions hold free-text names as keys with no
 * matching definition; those fall back to rendering the key as the label.
 */
export function resolveItem(ctx: GameStateContext, key: string): ResolvedItem {
    return ctx.itemDefs?.[key] ?? { key, label: key }
}
