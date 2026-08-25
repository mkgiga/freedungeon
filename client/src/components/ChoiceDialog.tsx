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
