import { createResource, createSignal, Show } from 'solid-js'
import { state } from '../../state'
import { trpc } from '../../trpc'
import { useModal } from '../Modal'
import { TextEditor } from '../TextEditor'
import { Text } from '../typography/Text'

/**
 * Settings for the Scenario collaborator, opened from its own panel rather than
 * the Preferences screen — they only mean anything while you're looking at the
 * agent they configure.
 */
function ScenarioAgentSettings() {
    const modal = useModal()
    const [shipped] = createResource(() => trpc.scenarioAgent.defaultSystemPrompt.query())

    // Blank is the resting state, and blank means "use the built-in
    // instructions". Pre-filling with the shipped text would make merely
    // opening this dialog and pressing Save fork the install from
    // SCENARIO_AGENT.md — a copy taken today that silently stops tracking every
    // later improvement. Most people will never touch this, so the default has
    // to be the safe one.
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

            {/* Collapsed rather than loaded into the field: useful to read
                before writing an override, without becoming one. */}
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

/** Opens the settings dialog. Shared by the docked panel and the phone screen. */
export function useScenarioAgentSettings() {
    const modal = useModal()
    return () => modal.open({
        title: 'Collaborator settings',
        fullscreen: true,
        content: () => <ScenarioAgentSettings />,
    })
}
