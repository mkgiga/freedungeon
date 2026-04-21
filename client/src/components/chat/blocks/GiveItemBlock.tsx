import { Text } from '../../typography/Text'
import type { GiveItemBlock as GiveItemBlockType } from '../blocks'
import { aOrAn, pluralizeItem } from './itemText'

export function GiveItemBlock(props: {
    block: GiveItemBlockType
    onUpdate: (block: GiveItemBlockType) => void
}) {
    // qty 0 is a no-op — don't clutter the transcript with empty lines.
    if (props.block.qty === 0) return null

    const isOne = () => props.block.qty === 1
    const word = () => isOne() ? props.block.name : pluralizeItem(props.block.name, props.block.qty)

    return (
        <Text size="base" class="chat-block chat-block-event chat-block-giveItem">
            {'You receive '}
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
