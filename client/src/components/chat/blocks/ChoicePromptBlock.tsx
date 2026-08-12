import { For } from 'solid-js'
import type { ChoicePromptBlock as ChoicePromptBlockType } from '../blocks'

/**
 * The agent's optional end-of-turn multiple-choice menu.
 *
 * Rendered inline in the history, which is also where it is answered. When
 * `interactive` (the menu is the latest message, unanswered, and the global
 * setting is on) the options are clickable; otherwise they're static — the
 * chosen one is highlighted and the rest dimmed.
 *
 * It used to be mirrored into the composer rail, which meant the rail grew with
 * the number of options and ate the vertical space the scene needs. Here it
 * scrolls with everything else and costs nothing when it's off screen.
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
