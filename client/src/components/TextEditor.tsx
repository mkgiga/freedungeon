import { Show, type Accessor } from 'solid-js'
import { MdFillOpen_in_full } from 'solid-icons/md'
import { useModal } from './Modal'
import { Heading } from './typography/Heading'
import { Text } from './typography/Text'

export function TextEditor(props: {
    title: string
    description?: string
    value: Accessor<string>
    onInput: (value: string) => void
    readOnly?: boolean
}) {
    const modal = useModal()

    const openExpanded = () => {
        modal.open({
            title: props.title,
            fullscreen: true,
            content: () => (
                <div class="flex flex-col flex-1 min-h-0">
                    <Show when={props.description}>
                        <Text size="sm" class="opacity-50 mb-3">{props.description}</Text>
                    </Show>
                    <textarea
                        value={props.value()}
                        readOnly={props.readOnly}
                        class="text-editor-textarea flex-1"
                        onInput={(e) => props.onInput(e.currentTarget.value)}
                    />
                </div>
            ),
        })
    }

    return (
        <div class="text-editor">
            <div class="flex items-center justify-between mb-1">
                <Heading level={2}>{props.title}</Heading>
                <Show when={!props.readOnly}>
                    <button class="text-editor-expand" onClick={openExpanded}>
                        <MdFillOpen_in_full size={16} />
                    </button>
                </Show>
            </div>
            <Show when={props.description}>
                <Text size="sm" class="opacity-50 mb-2">{props.description}</Text>
            </Show>
            <textarea
                value={props.value()}
                readOnly={props.readOnly}
                class="text-editor-textarea"
                onInput={(e) => props.onInput(e.currentTarget.value)}
            />
        </div>
    )
}
