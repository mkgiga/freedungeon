import { Show } from 'solid-js'
import type { ItemDefinition } from '@shared/types'
import { Text } from '../../typography/Text'
import { Em } from '../../typography/Em'
import { pickEmojiForItem } from './itemEmoji'

const CARD_WIDTH = 320
const GAP = 8

/**
 * Detail card for an inventory item. Positioned `fixed` against the slot's
 * viewport rect rather than nested in the slot, so the surrounding panel's
 * overflow can never clip it. `pointer-events: none` (in CSS) keeps it inert:
 * it can't steal the drag gesture or swallow the outside-tap that dismisses it.
 */
export function ItemCard(props: {
    item: ItemDefinition & { qty: number }
    /** Viewport rect of the slot this card describes. */
    anchor: DOMRect
}) {
    // Prefer above the slot; flip below when there isn't room. Clamp
    // horizontally so a slot near either edge still shows a full card.
    const placeBelow = () => props.anchor.top < 160
    const left = () => {
        const centred = props.anchor.left + props.anchor.width / 2 - CARD_WIDTH / 2
        return Math.max(GAP, Math.min(centred, window.innerWidth - CARD_WIDTH - GAP))
    }

    return (
        <div
            class="item-card"
            style={{
                left: `${left()}px`,
                width: `${CARD_WIDTH}px`,
                ...(placeBelow()
                    ? { top: `${props.anchor.bottom + GAP}px` }
                    : { bottom: `${window.innerHeight - props.anchor.top + GAP}px` }),
            }}
        >
            <div class="item-card-head">
                <Show
                    when={props.item.icon}
                    fallback={<span class="item-card-emoji">{pickEmojiForItem(props.item.label)}</span>}
                >
                    {(icon) => <img class="item-card-icon" src={icon()} alt="" />}
                </Show>
                <div class="item-card-title">
                    <Text size="base"><Em semibold>{props.item.label}</Em></Text>
                    <Show when={props.item.qty > 1}>
                        <Text size="sm" class="opacity-60">×{props.item.qty}</Text>
                    </Show>
                </div>
            </div>
            {/* The visual description is the fuller read; `description` stands in
              * for items defined before that field existed. */}
            <Show when={props.item.visualDescription ?? props.item.description}>
                {(body) => (
                    <Text size="sm" class="item-card-description whitespace-pre-wrap">{body()}</Text>
                )}
            </Show>
        </div>
    )
}
