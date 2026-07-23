import { Text } from '../../typography/Text'
import type { UseItemBlock as UseItemBlockType } from '../blocks'
import { state } from '../../../state'
import { aOrAn, pluralizeItem } from './itemText'

export function UseItemBlock(props: {
    block: UseItemBlockType
    onUpdate: (block: UseItemBlockType) => void
}) {
    if (props.block.qty === 0) return null

    const isOne = () => props.block.qty === 1
    const word = () => isOne() ? props.block.item : pluralizeItem(props.block.item, props.block.qty)
    const targetName = () => {
        for (const a of Object.values(state.assets.actors ?? {})) {
            if (a.customId === props.block.target) return a.name
        }
        return props.block.target
    }

    return (
        <Text size="base" class="chat-block chat-block-event chat-block-useItem">
            {'You use '}
            {isOne() ? (
                <>
                    {aOrAn(props.block.item) + ' '}
                    <span class="chat-block-event-item">{word()}</span>
                </>
            ) : (
                <>
                    <span class="chat-block-event-amount">{props.block.qty}</span>
                    {' '}
                    <span class="chat-block-event-item">{word()}</span>
                </>
            )}
            {' on '}
            <span class="chat-block-event-actor">{targetName()}</span>
            {'.'}
        </Text>
    )
}
