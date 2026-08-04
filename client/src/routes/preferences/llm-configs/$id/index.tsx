import { createFileRoute, useNavigate } from '@tanstack/solid-router'
import { state } from '../../../../state'
import { trpc } from '../../../../trpc'
import { TopBar } from '../../../../components/TopBar'
import { createEffect, Show } from 'solid-js'
import { MdFillCheck, MdFillAdd } from 'solid-icons/md'
import { createStore } from 'solid-js/store'
import { Heading } from '../../../../components/typography/Heading'
import { Text } from '../../../../components/typography/Text'
import { SchemaForm } from '../../../../components/json-ui'
import { TextEditor } from '../../../../components/TextEditor'
import type { SchemaField, SchemaFormHooks } from '@shared/schema-ui'
import { LLM_PRESETS } from '@shared/llm-presets'
import { pendingConfigEdit, setPendingConfigEdit } from '../../../../pending-nav'

export const Route = createFileRoute('/preferences/llm-configs/$id/')({
    component: RouteComponent,
    validateSearch: (search: Record<string, unknown>) => ({
        edit: search.edit === true || search.edit === 'true',
    }),
})

function RouteComponent() {
    const params = Route.useParams()
    const search = Route.useSearch()
    const routeId = () => params().id
    const edit = () => search().edit
    const navigate = useNavigate()

    const serverConfig = () => state.assets.llmConfigs[routeId()]
    const isNew = () => !serverConfig()

    const [draft, setDraft] = createStore(
        serverConfig() ?? {
            id: '',
            name: 'New Config',
            provider: 'custom' as const,
            endpoint: '',
            model: '',
            apiKey: '',
            systemPrompt: '',
            schema: [] as SchemaField[],
            values: {} as Record<string, any>,
            createdAt: Date.now(),
            updatedAt: Date.now(),
        }
    )

    // Seed a brand-new config with the house system prompt (RP_PROMPT.md), the
    // same one createFromPreset uses. Fetched rather than bundled so the client
    // doesn't carry a second copy that can drift from the file on disk. Only
    // applied while the field is still untouched, so a fast typist doesn't get
    // their input overwritten when the request lands.
    if (isNew()) {
        trpc.llmConfigs.defaultSystemPrompt.query().then((prompt) => {
            if (prompt && !draft.systemPrompt) setDraft('systemPrompt', prompt)
        })
    }

    /**
     * Arriving here straight from onboarding with a custom (OpenAI-compatible)
     * preset: its endpoint is a placeholder until the user points it at their
     * own server, so bring the field into view and mark it. Runs once — the
     * request is cleared as soon as it's honoured, so re-visiting the config
     * later is an ordinary edit.
     */
    let endpointInput: HTMLInputElement | undefined
    createEffect(() => {
        const pending = pendingConfigEdit()
        if (!pending || pending.id !== routeId() || !endpointInput) return
        setPendingConfigEdit(null)
        if (!pending.focusEndpoint) return

        const el = endpointInput
        // Next frame: the route has just mounted, so layout isn't settled and
        // scrollIntoView would measure the wrong position.
        requestAnimationFrame(() => {
            el.scrollIntoView({ block: 'center', behavior: 'smooth' })
            el.focus()
            el.select()
            el.classList.add('field-attention')
            el.addEventListener('animationend', () => el.classList.remove('field-attention'), { once: true })
        })
    })

    // Detect if schema matches a preset (non-editable)
    const isPresetSchema = () => {
        return Object.values(LLM_PRESETS).some(
            p => !p.editable && JSON.stringify(p.schema) === JSON.stringify(draft.schema)
        )
    }

    const schemaEditable = () => !isPresetSchema()

    const save = async () => {
        const result = await trpc.llmConfigs.upsert.mutate({
            id: isNew() ? undefined : draft.id,
            name: draft.name,
            provider: draft.provider,
            endpoint: draft.endpoint,
            model: draft.model,
            apiKey: draft.apiKey,
            systemPrompt: draft.systemPrompt,
            schema: JSON.stringify(draft.schema),
            values: JSON.stringify(draft.values),
        })
        if (edit()) {
            navigate({
                to: '/preferences/llm-configs/$id',
                params: { id: result.id },
                search: { edit: false },
                replace: true,
            })
        }
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
        editable: edit() && schemaEditable(),
        disabled: !edit(),
        onSchemaChange: (fields) => setDraft('schema', fields),
    })

    return (
        <div class="flex flex-col h-full overflow-hidden">
            <TopBar
                backButton
                title={draft.name}
                slots={{
                    right: edit() ? (
                        <button onClick={save}>
                            <MdFillCheck size={28} />
                        </button>
                    ) : undefined
                }}
            />

            <div class="flex-1 overflow-y-auto p-4">
                {/* Config Info */}
                <section class="mb-6">
                    <Heading level={2} class="mb-3">Configuration</Heading>
                    <div class="flex flex-col gap-3">
                        <label class="flex flex-col gap-1">
                            <Text size="sm" class="opacity-50">Name</Text>
                            <Show when={edit()} fallback={<Text>{draft.name}</Text>}>
                                <input
                                    type="text"
                                    value={draft.name}
                                    class="p-2 rounded-lg bg-(--bg) border border-[color-mix(in_oklch,var(--text),transparent_85%)]"
                                    onInput={(e) => setDraft('name', e.currentTarget.value)}
                                />
                            </Show>
                        </label>
                        <label class="flex flex-col gap-1">
                            <Text size="sm" class="opacity-50">Provider</Text>
                            <Show when={edit()} fallback={<Text>{draft.provider}</Text>}>
                                <select
                                    class="p-2 rounded-lg bg-(--bg) border border-[color-mix(in_oklch,var(--text),transparent_85%)]"
                                    value={draft.provider}
                                    onChange={(e) => setDraft('provider', e.currentTarget.value as any)}
                                >
                                    <option value="openai">OpenAI</option>
                                    <option value="anthropic">Anthropic</option>
                                    <option value="google">Google</option>
                                    <option value="custom">Custom (OpenAI v1 Compatible)</option>
                                </select>
                            </Show>
                        </label>
                        <label class="flex flex-col gap-1">
                            <Text size="sm" class="opacity-50">Endpoint URL</Text>
                            <Show when={edit()} fallback={<Text font="mono">{draft.endpoint || '—'}</Text>}>
                                <input
                                    ref={endpointInput}
                                    type="text"
                                    value={draft.endpoint}
                                    placeholder="https://api.openai.com/v1/chat/completions"
                                    class="p-2 rounded-lg bg-(--bg) border border-[color-mix(in_oklch,var(--text),transparent_85%)]"
                                    onInput={(e) => setDraft('endpoint', e.currentTarget.value)}
                                />
                            </Show>
                        </label>
                        <label class="flex flex-col gap-1">
                            <Text size="sm" class="opacity-50">Model</Text>
                            <Show when={edit()} fallback={<Text font="mono">{draft.model || '—'}</Text>}>
                                <input
                                    type="text"
                                    value={draft.model}
                                    placeholder="gpt-4o"
                                    class="p-2 rounded-lg bg-(--bg) border border-[color-mix(in_oklch,var(--text),transparent_85%)]"
                                    onInput={(e) => setDraft('model', e.currentTarget.value)}
                                />
                            </Show>
                        </label>
                        {/* Anthropic configs drive the Claude Code CLI, which
                            authenticates with its own stored sign-in — the key
                            here would never be sent anywhere. */}
                        <Show
                            when={draft.provider !== 'anthropic'}
                            fallback={
                                <div class="flex flex-col gap-1">
                                    <Text size="sm" class="opacity-50">API Key</Text>
                                    <Text size="sm" class="opacity-50">
                                        Not needed — Claude signs in through its own account.
                                    </Text>
                                </div>
                            }
                        >
                            <label class="flex flex-col gap-1">
                                <Text size="sm" class="opacity-50">API Key</Text>
                                <Show when={edit()} fallback={<Text font="mono">{draft.apiKey ? '••••••••' : '—'}</Text>}>
                                    <input
                                        type="password"
                                        value={draft.apiKey}
                                        placeholder="sk-..."
                                        class="p-2 rounded-lg bg-(--bg) border border-[color-mix(in_oklch,var(--text),transparent_85%)]"
                                        onInput={(e) => setDraft('apiKey', e.currentTarget.value)}
                                    />
                                </Show>
                            </label>
                        </Show>
                    </div>
                </section>

                {/* System Prompt */}
                <section class="mb-6">
                    <TextEditor
                        title="System Prompt"
                        description="Instructions prepended to every chat. Tells the model who it is and how to behave."
                        value={() => draft.systemPrompt}
                        onInput={(v) => setDraft('systemPrompt', v)}
                        readOnly={!edit()}
                    />
                </section>

                {/* Model Parameters */}
                <section class="mb-6">
                    <div class="flex items-center justify-between mb-3">
                        <Heading level={2}>Parameters</Heading>
                        <Show when={edit() && schemaEditable()}>
                            <button onClick={addField} class="opacity-50 hover:opacity-100">
                                <MdFillAdd size={20} />
                            </button>
                        </Show>
                    </div>
                    <Show when={draft.schema.length > 0} fallback={
                        <Text size="sm" class="opacity-50">No parameters configured.</Text>
                    }>
                        <SchemaForm
                            fields={draft.schema}
                            values={draft.values}
                            onChange={(v) => setDraft('values', v)}
                            hooks={hooks()}
                        />
                    </Show>
                </section>

                <Show when={isPresetSchema()}>
                    <Text size="sm" class="opacity-50">
                        This config uses a provider preset schema. Parameter structure cannot be edited, but values can be changed.
                    </Text>
                </Show>
            </div>
        </div>
    )
}
