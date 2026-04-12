import { createFileRoute, useNavigate } from '@tanstack/solid-router'
import { TopBar } from '../../components/TopBar'
import { state } from '../../state'
import { trpc } from '../../trpc'
import { For, Show } from 'solid-js'
import { MdFillAdd } from 'solid-icons/md'
import { Heading } from '../../components/typography/Heading'
import { Text } from '../../components/typography/Text'
import { Em } from '../../components/typography/Em'
import { LLMConfigList } from '../../components/llm-configs'
import { useModal } from '../../components/Modal'
import { LLM_PRESETS } from '@shared/llm-presets'

export const Route = createFileRoute('/preferences/')({
  component: RouteComponent,
})

function RouteComponent() {
  const navigate = useNavigate()
  const modal = useModal()

  const llmConfigs = () => Object.values(state.assets.llmConfigs ?? {})
  const actors = () => Object.values(state.assets.actors ?? {})

  const addConfig = () => {
    modal.open({
      title: 'New LLM Config',
      content: () => (
        <div class="flex flex-col gap-2">
          <Text size="sm" class="opacity-50 mb-2">Choose a preset or start from scratch</Text>
          <For each={Object.entries(LLM_PRESETS)}>
            {([key, preset]) => (
              <button
                class="w-full text-left p-3 rounded-lg border border-[color-mix(in_oklch,var(--text),transparent_85%)] hover:bg-(--bg-2) transition-colors"
                onClick={async () => {
                  const result = await trpc.llmConfigs.createFromPreset.mutate({ presetKey: key })
                  modal.close()
                  navigate({ to: '/preferences/llm-configs/$id', params: { id: result.id }, search: { edit: true } })
                }}
              >
                <Text><Em semibold>{preset.name}</Em></Text>
                <Text size="sm" class="opacity-50">{preset.endpoint}</Text>
              </button>
            )}
          </For>
        </div>
      ),
    })
  }

  return (
    <div class="flex flex-col h-full">
      <TopBar title="Preferences" />
      <div class="flex-1 overflow-y-auto p-4">
        {/* General Preferences */}
        <section class="mb-8">
          <Heading level={2} class="mb-4">General</Heading>

          <div class="flex flex-col gap-4">
            <label class="flex flex-col gap-1">
              <Text size="sm" class="opacity-50">Active LLM Config</Text>
              <select
                class="p-2 rounded-lg bg-(--bg) border border-[color-mix(in_oklch,var(--text),transparent_85%)]"
                value={state.userPreferences.activeLLMConfigId ?? ''}
                onChange={(e) => {
                  const val = e.currentTarget.value ? Number(e.currentTarget.value) : null
                  trpc.preferences.update.mutate({ activeLLMConfigId: val })
                }}
              >
                <option value="">None</option>
                <For each={llmConfigs()}>
                  {(config) => <option value={config.id}>{config.name} ({config.model})</option>}
                </For>
              </select>
            </label>

            <label class="flex flex-col gap-1">
              <Text size="sm" class="opacity-50">Player Character</Text>
              <select
                class="p-2 rounded-lg bg-(--bg) border border-[color-mix(in_oklch,var(--text),transparent_85%)]"
                value={state.userPreferences.playerCharacterId ?? ''}
                onChange={(e) => {
                  const val = e.currentTarget.value ? Number(e.currentTarget.value) : null
                  trpc.preferences.update.mutate({ playerCharacterId: val })
                }}
              >
                <option value="">None</option>
                <For each={actors()}>
                  {(actor) => <option value={actor.id}>{actor.name}</option>}
                </For>
              </select>
            </label>
          </div>
        </section>

        {/* LLM Configs */}
        <section>
          <div class="flex items-center justify-between mb-4">
            <Heading level={2}>LLM Configs</Heading>
            <button onClick={addConfig}>
              <MdFillAdd size={24} />
            </button>
          </div>
          <LLMConfigList
            configs={llmConfigs()}
            onConfigClick={(config) => {
              navigate({ to: '/preferences/llm-configs/$id', params: { id: String(config.id) }, search: { edit: false } })
            }}
            actions={[
              {
                label: 'Edit',
                callback: (config) => {
                  navigate({ to: '/preferences/llm-configs/$id', params: { id: String(config.id) }, search: { edit: true } })
                },
              },
              {
                label: 'Delete',
                danger: true,
                callback: (config) => {
                  modal.open({
                    title: 'Delete Config',
                    content: () => (
                      <div>
                        <Text>Are you sure you want to delete <Em type="danger" bold>{config.name}</Em>?</Text>
                        <div class="modal-confirm-actions">
                          <button class="modal-btn modal-btn-cancel" onClick={() => modal.close()}>Cancel</button>
                          <button class="modal-btn modal-btn-confirm" onClick={() => { trpc.llmConfigs.delete.mutate({ id: config.id }); modal.close() }}>Confirm</button>
                        </div>
                      </div>
                    ),
                  })
                },
              },
            ]}
          />
        </section>
      </div>
    </div>
  )
}
