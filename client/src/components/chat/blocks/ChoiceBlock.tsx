import type { ChoiceBlock as ChoiceBlockType } from '../blocks'

/**
 * A user's pick from a choice prompt — rendered as a "chosen action" chip so
 * it reads distinctly from a freely-typed action.
 */
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
