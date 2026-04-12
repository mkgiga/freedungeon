import { For } from 'solid-js'
import type { Actor } from '@shared/types'
import { useModal } from '../Modal'
import { Text } from '../typography/Text'

type ModalAPI = ReturnType<typeof useModal>

/**
 * Opens a modal showing the given actor's expressions. Calling `onPick` with
 * `undefined` clears the expression (reverts to default avatar).
 */
export function openExpressionPicker(opts: {
    modal: ModalAPI
    actor: Actor
    current?: string
    onPick: (expression: string | undefined) => void
}) {
    const { modal, actor, current, onPick } = opts
    const entries = Object.entries(actor.expressions ?? {})

    modal.open({
        title: `${actor.name} — Expressions`,
        content: () => (
            <div class="expression-picker">
                <button
                    class={`expression-picker-item ${current === undefined ? 'is-active' : ''}`}
                    onClick={() => {
                        onPick(undefined)
                        modal.close()
                    }}
                >
                    <div class="expression-picker-default">
                        {actor.avatarUrl
                            ? <img src={actor.avatarUrl} alt={actor.name} />
                            : <div class="expression-picker-placeholder">{actor.name.charAt(0).toUpperCase()}</div>
                        }
                    </div>
                    <Text size="sm">Default</Text>
                </button>
                <For each={entries} fallback={<Text size="sm" class="opacity-50">No expressions defined for this character.</Text>}>
                    {([name, url]) => (
                        <button
                            class={`expression-picker-item ${current === name ? 'is-active' : ''}`}
                            onClick={() => {
                                onPick(name)
                                modal.close()
                            }}
                        >
                            <img src={url} alt={name} />
                            <Text size="sm">{name}</Text>
                        </button>
                    )}
                </For>
            </div>
        ),
    })
}
