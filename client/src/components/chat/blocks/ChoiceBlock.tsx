import type { ChoiceBlock as ChoiceBlockType } from '../blocks'

export function ChoiceBlock(props: {
    block: ChoiceBlockType
    onUpdate: (block: ChoiceBlockType) => void
}) {
    return (
        <div class="chat-block chat-block-choice">
            <span class="chat-block-choice-text">{props.block.text}</span>
        </div>
    )
}
