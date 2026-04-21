import { Text } from '../../typography/Text'
import type { TakeItemBlock as TakeItemBlockType } from '../blocks'
import { aOrAn, pluralizeItem } from './itemText'

export function TakeItemBlock(props: {
    block: TakeItemBlockType
    onUpdate: (block: TakeItemBlockType) => void
}) {
    if (props.block.qty === 0) return null

    const isOne = () => props.block.qty === 1
    const word = () => isOne() ? props.block.name : pluralizeItem(props.block.name, props.block.qty)

    return (
        <Text size="base" class="chat-block chat-block-event chat-block-takeItem">
            {'You lose '}
            {isOne() ? (
                <>
                    {aOrAn(props.block.name) + ' '}
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
