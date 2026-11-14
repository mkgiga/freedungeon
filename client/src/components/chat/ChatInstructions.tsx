import { createResource, createSignal, Show } from 'solid-js'
import { trpc } from '../../trpc'
import { useModal } from '../Modal'
import { TextEditor } from '../TextEditor'
import { Text } from '../typography/Text'

function ChatInstructions(props: {
    value: string
    onSave: (systemPrompt: string) => void | Promise<void>
}) {
    const modal = useModal()
    const [shipped] = createResource(() => trpc.chat.defaultSystemPrompt.query())

    const [draft, setDraft] = createSignal<string | null>(null)
    const value = () => draft() ?? props.value

    const commit = async (next: string) => {
        await props.onSave(next)
        modal.close()
    }

    return (
        <div class="prompt-editor">
            <TextEditor
                title="System instructions"
                description="What the dungeon master is told before every turn. Leave blank to use the built-in instructions."
                value={value}
                onInput={setDraft}
            />

            <details class="prompt-editor-default">
                <summary><Text size="sm" class="opacity-60">View built-in instructions</Text></summary>
                <pre>{shipped() ?? ''}</pre>
            </details>

            <div class="editor-modal-footer">
                <Show when={Boolean(props.value.trim())}>
                    <button class="modal-btn modal-btn-cancel" onClick={() => commit('')}>Reset to default</button>
                </Show>
                <button class="modal-btn modal-btn-cancel" onClick={() => modal.close()}>Cancel</button>
                <button class="modal-btn modal-btn-confirm" onClick={() => commit(value())}>Save</button>
            </div>
        </div>
    )
}

export function useChatInstructions() {
    const modal = useModal()
    return (opts: { value: string; onSave: (systemPrompt: string) => void | Promise<void> }) =>
        modal.open({
            title: 'Instructions',
            fullscreen: true,
            content: () => <ChatInstructions value={opts.value} onSave={opts.onSave} />,
        })
}

export function instructionsSummary(systemPrompt: string | undefined): string {
    const first = (systemPrompt ?? '').trim().split('\n').find(line => line.trim())
    return first?.trim() || 'Default'
}
