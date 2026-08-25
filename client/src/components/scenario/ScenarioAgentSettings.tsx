import { createResource, createSignal, Show } from 'solid-js'
import { state } from '../../state'
import { trpc } from '../../trpc'
import { useModal } from '../Modal'
import { TextEditor } from '../TextEditor'
import { Text } from '../typography/Text'

function ScenarioAgentSettings() {
    const modal = useModal()
    const [shipped] = createResource(() => trpc.scenarioAgent.defaultSystemPrompt.query())

    const stored = () => state.userPreferences.scenarioAgent?.systemPrompt
    const [draft, setDraft] = createSignal<string | null>(null)
    const value = () => draft() ?? stored() ?? ''

    const isOverridden = () => Boolean(stored()?.trim())

    const save = async () => {
        await trpc.preferences.update.mutate({
            scenarioAgent: { ...state.userPreferences.scenarioAgent, systemPrompt: value() },
        })
        modal.close()
    }

    const revert = async () => {
        await trpc.preferences.update.mutate({
            scenarioAgent: { ...state.userPreferences.scenarioAgent, systemPrompt: '' },
        })
        modal.close()
    }

    return (
        <div class="scenario-agent-settings">
            <TextEditor
                title="System instructions"
                description="What the collaborator is told before every turn. Leave blank to use the built-in instructions."
                value={value}
                onInput={setDraft}
            />

            <details class="scenario-agent-default">
                <summary><Text size="sm" class="opacity-60">View built-in instructions</Text></summary>
                <pre>{shipped() ?? ''}</pre>
            </details>

            <div class="editor-modal-footer">
                <Show when={isOverridden()}>
                    <button class="modal-btn modal-btn-cancel" onClick={revert}>Reset to default</button>
                </Show>
                <button class="modal-btn modal-btn-cancel" onClick={() => modal.close()}>Cancel</button>
                <button class="modal-btn modal-btn-confirm" onClick={save}>Save</button>
            </div>
        </div>
    )
}

export function useScenarioAgentSettings() {
    const modal = useModal()
    return () => modal.open({
        title: 'Collaborator settings',
        fullscreen: true,
        content: () => <ScenarioAgentSettings />,
    })
}
