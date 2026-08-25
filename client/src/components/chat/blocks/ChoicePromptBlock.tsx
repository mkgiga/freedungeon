import { For } from 'solid-js'
import type { ChoicePromptBlock as ChoicePromptBlockType } from '../blocks'

/** `interactive` means: latest message, unanswered, and the setting is on. */
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
