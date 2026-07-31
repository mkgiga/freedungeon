import { Text } from '../../typography/Text'
import type { GiveItemBlock as GiveItemBlockType } from '../blocks'
import { state } from '../../../state'
import { resolveItem } from '../inventory/resolveItem'
import { aOrAn, pluralizeItem } from './itemText'

export function GiveItemBlock(props: {
    block: GiveItemBlockType
    onUpdate: (block: GiveItemBlockType) => void
}) {
    // qty 0 is a no-op — don't clutter the transcript with empty lines.
    if (props.block.qty === 0) return null

    // block.name holds the item's definition key; render its label.
    const label = () => resolveItem(state.currentChat.gameState, props.block.name).label
    const isOne = () => props.block.qty === 1
    const word = () => isOne() ? label() : pluralizeItem(label(), props.block.qty)

    return (
        <Text size="base" class="chat-block chat-block-event chat-block-giveItem">
            {'You receive '}
            {isOne() ? (
                <>
                    {aOrAn(label()) + ' '}
                    <span class="chat-block-event-item">{word()}</span>
                </>
            ) : (
                <>
                    <span class="chat-block-event-amount">{props.block.qty}</span>
                    {' '}
                    <span class="chat-block-event-item">{word()}</span>
                </>
            )}
            {'.'}
        </Text>
    )
}
