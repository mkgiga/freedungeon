import { createEffect, createMemo, createSignal, For, Show } from 'solid-js'
import { MdFillAdd, MdFillChevron_left, MdFillChevron_right, MdFillCheck } from 'solid-icons/md'
import { state } from '../state'
import { trpc } from '../trpc'
import { viewport } from '../viewport'
import { useModal } from './Modal'
import { LlmConfigEditor } from './LlmConfigEditor'
import { Text } from './typography/Text'
import { Em } from './typography/Em'
import { LLM_PRESETS } from '@shared/llm-presets'
import type { LLMConfig } from '@shared/types'

export function LlmConfigsDialog(props: { initialId?: string | null }) {
    const modal = useModal()
    const [activeId, setActiveId] = createSignal<string | null>(props.initialId ?? null)

    const isPhone = () => viewport() === 'phone'
    const configs = createMemo(() =>
        Object.values(state.assets.llmConfigs ?? {}).sort((a, b) => a.name.localeCompare(b.name))
    )
    const activeConfig = () => {
        const id = activeId()
        return id ? state.assets.llmConfigs?.[id] ?? null : null
    }

    createEffect(() => {
        if (isPhone() || activeId() !== null) return
        const first = configs()[0]
        if (first) setActiveId(first.id)
    })

    createEffect(() => {
        const id = activeId()
        if (id && !state.assets.llmConfigs?.[id]) setActiveId(null)
    })

    const activate = (config: LLMConfig) =>
        trpc.preferences.update.mutate({ activeLLMConfigId: config.id })

    const create = useLlmConfigCreate()

    const confirmDelete = (config: LLMConfig) => {
        modal.open({
            title: 'Delete model',
            content: () => (
                <div>
                    <Text>Are you sure you want to delete <Em type="danger" bold>{config.name}</Em>?</Text>
                    <div class="modal-confirm-actions">
                        <button class="modal-btn modal-btn-cancel" onClick={() => modal.close()}>Cancel</button>
                        <button
                            class="modal-btn modal-btn-confirm"
                            onClick={() => {
                                trpc.llmConfigs.delete.mutate({ id: config.id })
                                modal.close()
                                setActiveId(null)
                            }}
                        >
                            Delete
                        </button>
                    </div>
                </div>
            ),
        })
    }

    const showList = () => !isPhone() || activeId() === null
    const showPane = () => !isPhone() || activeId() !== null

    return (
        <div class="rail-dialog">
            <Show when={showList()}>
                <nav class="rail-dialog-rail">
                    <div class="rail-dialog-items">
                        <For each={configs()} fallback={
                            <Text size="sm" class="settings-hint p-3">No models yet.</Text>
                        }>
                            {(config) => (
                                <button
                                    type="button"
                                    class="rail-dialog-item"
                                    classList={{ active: !isPhone() && activeId() === config.id }}
                                    onClick={() => setActiveId(config.id)}
                                >
                                    <span class="rail-dialog-item-text">
                                        <Text class="rail-dialog-item-label">{config.name}</Text>
                                        <Text size="sm" class="rail-dialog-item-sublabel">
                                            {config.model || config.provider}
                                        </Text>
                                    </span>
                                    <Show
                                        when={state.userPreferences.activeLLMConfigId !== config.id}
                                        fallback={<MdFillCheck size={18} class="rail-dialog-item-badge" title="In use" />}
                                    >
                                        <span
                                            role="button"
                                            tabindex="0"
                                            class="rail-dialog-item-use"
                                            title={`Use ${config.name}`}
                                            onClick={(e) => { e.stopPropagation(); activate(config) }}
                                            onKeyDown={(e) => {
                                                if (e.key !== 'Enter' && e.key !== ' ') return
                                                e.preventDefault()
                                                e.stopPropagation()
                                                activate(config)
                                            }}
                                        >
                                            Use
                                        </span>
                                    </Show>
                                    <Show when={isPhone()}>
                                        <MdFillChevron_right size={20} class="rail-dialog-item-chevron" />
                                    </Show>
                                </button>
                            )}
                        </For>
                    </div>
                    <div class="rail-dialog-rail-footer">
                        <button type="button" class="rail-dialog-add" onClick={() => create(setActiveId)}>
                            <MdFillAdd size={20} />
                            <Text>New model</Text>
                        </button>
                    </div>
                </nav>
            </Show>

            <Show when={showPane()}>
                <div class="rail-dialog-pane">
                    <Show when={isPhone() && activeConfig()}>
                        {(config) => (
                            <button type="button" class="rail-dialog-back" onClick={() => setActiveId(null)}>
                                <MdFillChevron_left size={20} />
                                <Text>{config().name}</Text>
                            </button>
                        )}
                    </Show>
                    <div class="rail-dialog-pane-body">
                        <Show
                            when={activeConfig()}
                            fallback={
                                <Text size="sm" class="settings-hint rail-dialog-pane-empty">
                                    Select a model, or create one.
                                </Text>
                            }
                        >
                            {(config) => (
                                <Show when={config().id} keyed>
                                    <LlmConfigEditor
                                        id={config().id}
                                        onDelete={() => confirmDelete(config())}
                                        onCancel={() => modal.close()}
                                    />
                                </Show>
                            )}
                        </Show>
                    </div>
                </div>
            </Show>
        </div>
    )
}

export function useLlmConfigCreate() {
    const modal = useModal()
    return (onCreated: (id: string) => void) => {
        modal.open({
            title: 'New model',
            content: () => (
                <div class="choice-dialog">
                    <For each={Object.entries(LLM_PRESETS)}>
                        {([key, preset]) => (
                            <button
                                type="button"
                                class="choice-dialog-option"
                                onClick={async () => {
                                    const result = await trpc.llmConfigs.createFromPreset.mutate({ presetKey: key })
                                    modal.close()
                                    onCreated(result.id)
                                }}
                            >
                                <span class="choice-dialog-text">
                                    <Text><Em semibold>{preset.name}</Em></Text>
                                </span>
                            </button>
                        )}
                    </For>
                </div>
            ),
        })
    }
}

export function useLlmConfigs() {
    const modal = useModal()
    return {
        open: (id?: string) => modal.open({
            title: 'Models',
            fullscreen: true,
            content: () => <LlmConfigsDialog initialId={id ?? null} />,
        }),
    }
}
