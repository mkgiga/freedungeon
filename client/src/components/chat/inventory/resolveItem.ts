import type { GameStateContext, ItemDefinition } from '@shared/types'
import { state } from '../../../state'

export type ResolvedItem = ItemDefinition

/**
 * Whether an icon is still being generated for this item.
 *
 * Read from `activities` rather than from anything on the item, and that choice
 * is the point. "Being generated" is a fact about this server process right
 * now, not about the story: the define_item block is persisted and replayed
 * forever, so a pending marker living there would survive a crash, a restart,
 * an export — items stuck mid-generation for good, with no job left to finish
 * them. Activities are never persisted and start empty every boot, so the
 * spinner can only ever exist while something is actually running.
 *
 * It also keeps `icon` honest as a URL. Parking a job id in that field would
 * put a non-URL into replayed history.
 */
export function isIconPending(key: string): boolean {
    return Object.values(state.activities ?? {}).some(
        a => a.kind === 'generatingItemIcon' && (a.data as { key?: string }).key === key,
    )
}

/**
 * Resolve an inventory key to its definition. Chats written before item
 * definitions existed hold free-text names as keys and have no matching
 * definition — those fall back to rendering the key itself as the label, which
 * is exactly what they used to display.
 */
export function resolveItem(ctx: GameStateContext, key: string): ResolvedItem {
    return ctx.itemDefs?.[key] ?? { key, label: key }
}
