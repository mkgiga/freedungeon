import { createEffect, Show } from 'solid-js'
import { createStore, reconcile } from 'solid-js/store'
import { MdFillAdd, MdFillWarning } from 'solid-icons/md'
import { state } from '../state'
import { trpc } from '../trpc'
import { useToast } from './Toast'
import { Text } from './typography/Text'
import { Heading } from './typography/Heading'
import { SchemaForm } from './json-ui'
import { SettingsField, SettingsGroup, SettingsInput } from './settings'
import type { SchemaField, SchemaFormHooks } from '@shared/schema-ui'
import type { LLMProvider } from '@shared/types'
import { LLM_PRESETS } from '@shared/llm-presets'
import { pendingConfigEdit, setPendingConfigEdit } from '../pending-nav'

export function LlmConfigEditor(props: {
    id: string
    onSaved?: (id: string) => void
    onDelete?: () => void
    onCancel?: () => void
}) {
    const toast = useToast()

    const serverConfig = () => state.assets.llmConfigs[props.id]

    const [draft, setDraft] = createStore(blankConfig())

    createEffect(() => {
        const config = serverConfig()
        if (config) setDraft(reconcile({ ...blankConfig(), ...config }))
    })

    let endpointInput: HTMLInputElement | undefined
    createEffect(() => {
        const pending = pendingConfigEdit()
        if (!pending || pending.id !== props.id || !endpointInput) return
        setPendingConfigEdit(null)
        if (!pending.focusEndpoint) return

        const el = endpointInput
        requestAnimationFrame(() => {
            el.scrollIntoView({ block: 'center', behavior: 'smooth' })
            el.focus()
            el.select()
            el.classList.add('field-attention')
            el.addEventListener('animationend', () => el.classList.remove('field-attention'), { once: true })
        })
    })

    const isPresetSchema = () => Object.values(LLM_PRESETS).some(
        p => !p.editable && JSON.stringify(p.schema) === JSON.stringify(draft.schema)
    )

    const save = async () => {
        try {
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
            toast.success(`${draft.name?.trim() || 'Model'} saved`)
            props.onSaved?.(result.id)
        } catch (e) {
            toast.error((e as Error).message || 'Could not save this model.')
            throw e
        }
    }

    const addField = () => {
        const newField: SchemaField = {
            path: [`param_${draft.schema.length}`],
            label: 'New parameter',
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

function ClaudeAuthNotice() {
    const dep = () => state.dependencies?.claudeCli

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
