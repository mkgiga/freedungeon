import type { GameStateContext, ItemDefinition } from '@shared/types'
import { state } from '../../../state'

export type ResolvedItem = ItemDefinition

/**
 * Whether an icon is still being generated for this item.
 *
 * Read from `activities`, which is never persisted and starts empty each boot,
 * so a spinner can only exist while a job is actually running. A pending marker
 * on the define_item block would survive a crash and strand the item forever,
 * and would put a non-URL into `icon`.
 */
export function isIconPending(key: string): boolean {
    return Object.values(state.activities ?? {}).some(
        a => a.kind === 'generatingItemIcon' && (a.data as { key?: string }).key === key,
    )
}

/**
 * Resolve an inventory key to its definition. Chats written before item
 * definitions existed hold free-text names as keys with no matching definition;
 * those fall back to rendering the key itself as the label.
 */
export function resolveItem(ctx: GameStateContext, key: string): ResolvedItem {
    return ctx.itemDefs?.[key] ?? { key, label: key }
}
