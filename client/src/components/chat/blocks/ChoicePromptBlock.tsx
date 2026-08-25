import { For } from 'solid-js'
import type { ChoicePromptBlock as ChoicePromptBlockType } from '../blocks'

/**
 * The agent's optional end-of-turn choice menu, rendered and answered inline in
 * the history.
 *
 * `interactive` - latest message, unanswered, setting on - makes the options
 * clickable. Otherwise the chosen one is highlighted and the rest dimmed.
 */
export function ChoicePromptBlock(props: {
    block: ChoicePromptBlockType
    chosenIndex?: number
    interactive: boolean
    onChoose: (index: number) => void
}) {
    return (
        <div class="chat-block chat-block-choice-prompt" role="group" aria-label="Choices">
            <For each={props.block.options}>
                {(option, i) => (
                    <button
                        type="button"
                        class="choice-prompt-option"
                        classList={{
                            'is-chosen': props.chosenIndex === i(),
                            'is-dimmed': props.chosenIndex != null && props.chosenIndex !== i(),
                        }}
                        disabled={!props.interactive}
                        onClick={() => props.onChoose(i())}
                    >
                        {option}
                    </button>
                )}
            </For>
        </div>
    )
}
