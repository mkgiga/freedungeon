import { Text } from '../../typography/Text'
import type { TakeItemBlock as TakeItemBlockType } from '../blocks'
import { state } from '../../../state'
import { resolveItem } from '../inventory/resolveItem'
import { aOrAn, pluralizeItem } from './itemText'

export function TakeItemBlock(props: {
    block: TakeItemBlockType
    onUpdate: (block: TakeItemBlockType) => void
}) {
    if (props.block.qty === 0) return null

    const label = () => resolveItem(state.currentChat.gameState, props.block.name).label
    const isOne = () => props.block.qty === 1
    const word = () => isOne() ? label() : pluralizeItem(label(), props.block.qty)

    return (
        <Text size="base" class="chat-block chat-block-event chat-block-takeItem">
            {'You lose '}
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
