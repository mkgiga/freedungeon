import type { GameStateContext, ItemDefinition } from '@shared/types'

export type ResolvedItem = ItemDefinition

/**
 * Resolve an inventory key to its definition. Chats written before item
 * definitions existed hold free-text names as keys and have no matching
 * definition — those fall back to rendering the key itself as the label, which
 * is exactly what they used to display.
 */
export function resolveItem(ctx: GameStateContext, key: string): ResolvedItem {
    return ctx.itemDefs?.[key] ?? { key, label: key }
}
