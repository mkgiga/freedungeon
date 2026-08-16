import { createEffect, Show } from 'solid-js'
import { createStore, reconcile } from 'solid-js/store'
import { MdFillAdd, MdFillWarning } from 'solid-icons/md'
import { state } from '../state'
import { trpc } from '../trpc'
import { Text } from './typography/Text'
import { Heading } from './typography/Heading'
import { SchemaForm } from './json-ui'
import { SettingsField, SettingsGroup, SettingsInput } from './settings'
import type { SchemaField, SchemaFormHooks } from '@shared/schema-ui'
import type { LLMProvider } from '@shared/types'
import { LLM_PRESETS } from '@shared/llm-presets'
import { pendingConfigEdit, setPendingConfigEdit } from '../pending-nav'

/**
 * Editor for one LLM config, extracted from the route it used to be so it can
 * sit in the configs dialog's detail pane. Same shape as the ActorEditor and
 * NoteEditor extractions.
 *
 * The route had a view mode and an edit mode, because it was a screen with a
 * TopBar check button. A settings pane you opened by clicking the thing you
 * want to change has no use for a read-only state, so the fields are always
 * live and Save is explicit.
 */
export function LlmConfigEditor(props: {
    id: string
    onSaved?: (id: string) => void
    onDelete?: () => void
    /** Omit to leave the button out — the rail renders whatever it's given. */
    onCancel?: () => void
}) {
    const serverConfig = () => state.assets.llmConfigs[props.id]

    const [draft, setDraft] = createStore(blankConfig())

    // Re-seed when the pane is pointed at a different config. `reconcile` rather
    // than a fresh store so the SchemaForm's field components are updated in
    // place instead of being torn down and rebuilt on every switch.
    createEffect(() => {
        const config = serverConfig()
        if (config) setDraft(reconcile({ ...blankConfig(), ...config }))
    })

    /**
     * Arriving here straight from onboarding with a custom (OpenAI-compatible)
     * preset: its endpoint is a placeholder until the user points it at their
     * own server, so bring the field into view and mark it. Runs once — the
     * request is cleared as soon as it's honoured, so opening the config later
     * is an ordinary edit.
     */
    let endpointInput: HTMLInputElement | undefined
    createEffect(() => {
        const pending = pendingConfigEdit()
        if (!pending || pending.id !== props.id || !endpointInput) return
        setPendingConfigEdit(null)
        if (!pending.focusEndpoint) return

        const el = endpointInput
        // Next frame: the pane has just mounted, so layout isn't settled and
        // scrollIntoView would measure the wrong position.
        requestAnimationFrame(() => {
            el.scrollIntoView({ block: 'center', behavior: 'smooth' })
            el.focus()
            el.select()
            el.classList.add('field-attention')
            el.addEventListener('animationend', () => el.classList.remove('field-attention'), { once: true })
        })
    })

    // A preset's parameter set is fixed: the values are yours to change, the
    // structure isn't.
    const isPresetSchema = () => Object.values(LLM_PRESETS).some(
        p => !p.editable && JSON.stringify(p.schema) === JSON.stringify(draft.schema)
    )

    const save = async () => {
        const result = await trpc.llmConfigs.upsert.mutate({
            id: draft.id || undefined,
            name: draft.name,
            provider: draft.provider,
            endpoint: draft.endpoint,
            model: draft.model,
            apiKey: draft.apiKey,
            schema: JSON.stringify(draft.schema),
            values: JSON.stringify(draft.values),
        })
        props.onSaved?.(result.id)
    }

    const addField = () => {
        const newField: SchemaField = {
            path: [`param_${draft.schema.length}`],
            label: 'New Parameter',
            default: '',
            control: { type: 'text' },
        }
        setDraft('schema', [...draft.schema, newField])
    }

    const hooks = (): SchemaFormHooks => ({
        editable: !isPresetSchema(),
        disabled: false,
        onSchemaChange: (fields) => setDraft('schema', fields),
    })

    // Two children, deliberately: the fields scroll, the action rail doesn't.
    // Save used to be the last thing in the scrolling column, which meant that
    // on a config with a long system prompt or a big parameter set it only
    // existed if you scrolled to the very bottom looking for it.
    return (
        <div class="editor-pane">
            <div class="editor-pane-scroll">
                <Show when={draft.provider === 'anthropic'}>
                    <ClaudeAuthNotice />
                </Show>

            <SettingsGroup title="Connection">
                <SettingsField label="Name">
                    <SettingsInput value={draft.name} onInput={(v) => setDraft('name', v)} />
                </SettingsField>

                <SettingsField label="Provider">
                    <select
                        class="settings-input"
                        value={draft.provider}
                        onChange={(e) => setDraft('provider', e.currentTarget.value as any)}
                    >
                        <option value="openai">OpenAI</option>
                        <option value="anthropic">Anthropic</option>
                        <option value="google">Google</option>
                        <option value="custom">Custom (OpenAI v1 Compatible)</option>
                    </select>
                </SettingsField>

                <SettingsField label="Endpoint URL">
                    <SettingsInput
                        ref={(el) => { endpointInput = el }}
                        value={draft.endpoint}
                        onInput={(v) => setDraft('endpoint', v)}
                        placeholder="https://api.openai.com/v1/chat/completions"
                        mono
                    />
                </SettingsField>

                <SettingsField label="Model">
                    <SettingsInput
                        value={draft.model}
                        onInput={(v) => setDraft('model', v)}
                        placeholder="gpt-4o"
                        mono
                    />
                </SettingsField>

                {/* Anthropic configs drive the Claude Code CLI, which
                    authenticates with its own stored sign-in — a key here would
                    never be sent anywhere, so the field is simply absent. The
                    notice above is what stands in for it. */}
                <Show when={draft.provider !== 'anthropic'}>
                    <SettingsField label="API Key">
                        <SettingsInput
                            type="password"
                            value={draft.apiKey}
                            onInput={(v) => setDraft('apiKey', v)}
                            placeholder="sk-..."
                        />
                    </SettingsField>
                </Show>
            </SettingsGroup>

            <SettingsGroup>
                <div class="settings-group-header">
                    <Heading level={3} class="settings-group-title">Parameters</Heading>
                    <Show when={!isPresetSchema()}>
                        <button type="button" class="settings-icon-btn" onClick={addField} title="Add parameter">
                            <MdFillAdd size={20} />
                        </button>
                    </Show>
                </div>
                <Show
                    when={draft.schema.length > 0}
                    fallback={<Text size="sm" class="settings-hint">No parameters configured.</Text>}
                >
                    <SchemaForm
                        fields={draft.schema}
                        values={draft.values}
                        onChange={(v) => setDraft('values', v)}
                        hooks={hooks()}
                    />
                </Show>
                <Show when={isPresetSchema()}>
                    <Text size="sm" class="settings-hint">
                        Preset parameters — values can change, the structure can't.
                    </Text>
                </Show>
            </SettingsGroup>
            </div>

            {/* Sibling of the scroller, not its last child — that's what keeps
                it on screen. Delete sits apart from the pair on the right so a
                misfire lands on Cancel rather than on the destructive one. */}
            <div class="editor-pane-footer">
                <Show when={props.onDelete}>
                    <button type="button" class="modal-btn modal-btn-danger" onClick={() => props.onDelete!()}>
                        Delete
                    </button>
                </Show>
                <span class="editor-pane-footer-spacer" />
                <Show when={props.onCancel}>
                    <button type="button" class="modal-btn modal-btn-cancel" onClick={() => props.onCancel!()}>
                        Cancel
                    </button>
                </Show>
                <button type="button" class="modal-btn modal-btn-confirm" onClick={save}>Save</button>
            </div>
        </div>
    )
}

/**
 * Anthropic's readiness, at the top of the config it affects.
 *
 * The Agent SDK has no programmatic auth of its own — it spawns the Claude Code
 * CLI and inherits whatever credentials that CLI has stored. So there is no key
 * to type here, and "is this config usable?" is answered by the CLI's own login
 * state, which the server already derives (`claude auth status --json`) and
 * publishes as `dependencies.claudeCli`.
 *
 * The button only *starts* the flow. Everything after that — the OAuth URL, the
 * paste-a-code fallback, cancelling — is PatcherOverlay's, which covers the
 * screen for any dependency in a blocking state. Duplicating it here would mean
 * two sign-in UIs racing the same subprocess.
 */
function ClaudeAuthNotice() {
    const dep = () => state.dependencies?.claudeCli

    // 'satisfied' is the only state with nothing to say. Absent means the server
    // hasn't reported yet, and claiming a problem before we know of one would be
    // worse than staying quiet.
    const problem = () => {
        const status = dep()?.status
        if (!status || status === 'satisfied') return null
        switch (status) {
            case 'unauthenticated':
                return {
                    message: 'No Claude account is connected, so this model can\'t run yet.',
                    action: 'Sign in to Claude',
                    run: () => trpc.dependencies.signIn.mutate(),
                }
            case 'downloading':
            case 'authenticating':
                return { message: 'Setting up Claude Code…', action: null, run: null }
            case 'failed':
                return {
                    message: dep()?.error ?? 'Claude Code could not be downloaded.',
                    action: 'Retry',
                    run: () => trpc.dependencies.ensure.mutate({ key: 'claudeCli' }),
                }
            default:
                // 'missing' and 'corrupt' both resolve the same way: fetch it.
                // Once the bytes are there the server re-derives status, which
                // lands on 'unauthenticated' and the patcher offers sign-in.
                return {
                    message: 'Claude Code isn\'t installed yet. Anthropic models run through it.',
                    action: 'Download Claude Code',
                    run: () => trpc.dependencies.ensure.mutate({ key: 'claudeCli' }),
                }
        }
    }

    return (
        <Show when={problem()}>
            {(p) => (
                <div class="settings-notice">
                    <MdFillWarning size={20} class="settings-notice-icon" />
                    <div class="settings-notice-body">
                        <Text size="sm">{p().message}</Text>
                        <Show when={p().action}>
                            {(label) => (
                                <button type="button" class="settings-inline-btn" onClick={() => p().run?.()}>
                                    {label()}
                                </button>
                            )}
                        </Show>
                    </div>
                </div>
            )}
        </Show>
    )
}

function blankConfig() {
    return {
        id: '',
        name: '',
        provider: 'custom' as LLMProvider,
        endpoint: '',
        model: '',
        apiKey: '',
        schema: [] as SchemaField[],
        values: {} as Record<string, any>,
        createdAt: 0,
        updatedAt: 0,
    }
}
