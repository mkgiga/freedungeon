import type { ChoiceBlock as ChoiceBlockType } from '../blocks'

/**
 * A user's pick from a choice prompt, rendered exactly like a freely-typed
 * action: once chosen, it *is* the player's action, and the answered menu is
 * still shown above it with the pick highlighted if you want to know it came
 * from a list.
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
