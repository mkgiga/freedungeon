import { For } from 'solid-js'
import { Text } from './typography/Text'
import { Em } from './typography/Em'
import type { JSXElement } from 'solid-js'

export type Choice = {
    label: string
    hint: string
    icon?: JSXElement
    onClick: () => void
}

/**
 * A fork between two ways of doing the same thing.
 *
 * For where an "add" is ambiguous - adding a character to a Scenario can mean
 * writing a new one or pulling one from the library. Naming both paths makes
 * the second discoverable rather than assumed.
 */
export function ChoiceDialog(props: { choices: Choice[] }) {
    return (
        <div class="choice-dialog">
            <For each={props.choices}>
                {(choice) => (
                    <button type="button" class="choice-dialog-option" onClick={choice.onClick}>
                        <span class="choice-dialog-icon">{choice.icon}</span>
                        <span class="choice-dialog-text">
                            <Text><Em semibold>{choice.label}</Em></Text>
                            <Text size="sm" class="opacity-60">{choice.hint}</Text>
                        </span>
                    </button>
                )}
            </For>
        </div>
    )
}
