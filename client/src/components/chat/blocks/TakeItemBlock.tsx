import pluralize from 'pluralize'
import type { TakeItemBlock as TakeItemBlockType } from '../blocks'

const aOrAn = (word: string) => /^[aeiou]/i.test(word) ? 'an' : 'a'

export function TakeItemBlock(props: {
    block: TakeItemBlockType
    onUpdate: (block: TakeItemBlockType) => void
}) {
    if (props.block.qty === 0) return null

    const isOne = () => props.block.qty === 1
    const word = () => isOne() ? props.block.name : pluralize(props.block.name, props.block.qty)

    return (
        <div class="chat-block chat-block-event chat-block-takeItem">
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
        </div>
    )
}
