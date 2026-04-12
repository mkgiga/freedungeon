import { createFileRoute, useNavigate } from '@tanstack/solid-router'
import { state } from '../../../../state'
import { trpc } from '../../../../trpc'
import { TopBar } from '../../../../components/TopBar'
import { Show } from 'solid-js'
import { MdFillCheck, MdFillAdd } from 'solid-icons/md'
import { createStore } from 'solid-js/store'
import { Heading } from '../../../../components/typography/Heading'
import { Text } from '../../../../components/typography/Text'
import { SchemaForm } from '../../../../components/json-ui'
import type { SchemaField, SchemaFormHooks } from '@shared/schema-ui'
import { LLM_PRESETS } from '@shared/llm-presets'

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

    const serverConfig = () => {
        const id = Number(routeId())
        return isNaN(id) ? undefined : state.assets.llmConfigs[id]
    }
    const isNew = () => !serverConfig()

    const [draft, setDraft] = createStore(
        serverConfig() ?? {
            id: 0,
            name: 'New Config',
            provider: 'custom' as const,
            endpoint: '',
            model: '',
            apiKey: '',
            schema: [] as SchemaField[],
            values: {} as Record<string, any>,
            createdAt: Date.now(),
            updatedAt: Date.now(),
        }
    )

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
            schema: JSON.stringify(draft.schema),
            values: JSON.stringify(draft.values),
        })
        if (edit()) {
            navigate({
                to: '/preferences/llm-configs/$id',
                params: { id: String(result.id) },
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
        <div class="flex flex-col h-full">
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
                    </div>
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
