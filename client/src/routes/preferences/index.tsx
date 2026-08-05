import { createFileRoute, useNavigate } from '@tanstack/solid-router'
import { TopBar } from '../../components/TopBar'
import { state } from '../../state'
import { trpc } from '../../trpc'
import { createEffect, For, Show } from 'solid-js'
import { MdFillAdd } from 'solid-icons/md'
import { Heading } from '../../components/typography/Heading'
import { Text } from '../../components/typography/Text'
import { Em } from '../../components/typography/Em'
import { LLMConfigList } from '../../components/llm-configs'
import { useModal } from '../../components/Modal'
import { PlayerCharacterPicker } from '../../components/chat/AssetPicker'
import { ImageIcon } from '../../components/ImageIcon'
import { LLM_PRESETS } from '@shared/llm-presets'
import { FEATURES, resolveFeatureConfig, type FeatureKey } from '@shared/features'
import { SchemaForm } from '../../components/json-ui'
import { installAvailable, isStandalone, triggerInstall } from '../../pwa-install'
import { pendingConfigEdit } from '../../pending-nav'

export const Route = createFileRoute('/preferences/')({
  component: RouteComponent,
})

function RouteComponent() {
  const navigate = useNavigate()
  const modal = useModal()

  const llmConfigs = () => Object.values(state.assets.llmConfigs ?? {})

  // Onboarding can't navigate itself — it's mounted outside the routers — so
  // it leaves a request here and this route performs it. The signal isn't
  // cleared yet; the editor clears it once it has used `focusEndpoint`.
  createEffect(() => {
    const pending = pendingConfigEdit()
    if (!pending) return
    navigate({ to: '/preferences/llm-configs/$id', params: { id: pending.id }, search: { edit: true } })
  })

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
    <div class="flex flex-col h-full overflow-hidden">
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
                  const val = e.currentTarget.value || null
                  trpc.preferences.update.mutate({ activeLLMConfigId: val })
                }}
              >
                <option value="">None</option>
                <For each={llmConfigs()}>
                  {(config) => <option value={config.id}>{config.name} ({config.model})</option>}
                </For>
              </select>
            </label>

            {/* Directly under the selector rather than at the foot of the page:
                the list is where you go to create the thing the selector is
                asking you to choose, and below the fold it may as well not
                exist for a first-time user. */}
            <div class="flex flex-col gap-1">
              <div class="flex items-center justify-between">
                <Text size="sm" class="opacity-50">LLM Configs</Text>
                <button onClick={addConfig} title="New LLM config">
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
            </div>

            <label class="flex flex-col gap-1">
              <Text size="sm" class="opacity-50">Player Character</Text>
              <button
                type="button"
                class="flex items-center gap-3 p-2 rounded-lg bg-(--bg) text-left hover:bg-[color-mix(in_oklch,var(--text),transparent_92%)]"
                style={{ border: '1px solid color-mix(in oklch, var(--text), transparent 85%)' }}
                onClick={() => {
                  modal.open({
                    title: 'Player Character',
                    content: () => <PlayerCharacterPicker onPick={() => modal.close()} />,
                  })
                }}
              >
                {(() => {
                  const id = state.userPreferences.playerCharacterId
                  const actor = id ? state.assets.actors?.[id] : null
                  if (!actor) return <Text class="opacity-50">None</Text>
                  return (
                    <>
                      <ImageIcon url={actor.avatarUrl} size={28} />
                      <Text>{actor.name}</Text>
                    </>
                  )
                })()}
              </button>
            </label>

            <label class="flex items-center gap-3">
              <input
                type="checkbox"
                checked={state.userPreferences.debug ?? false}
                onChange={(e) => trpc.preferences.update.mutate({ debug: e.currentTarget.checked })}
              />
              <span class="flex flex-col">
                <Text>Debug mode</Text>
                <Text size="sm" class="opacity-50">Adds a button in chats to inspect the exact prompt sent.</Text>
              </span>
            </label>
          </div>
        </section>

        {/* Features */}
        <section class="mb-8">
          <Heading level={2} class="mb-4">Optional Features</Heading>
          <div class="flex flex-col gap-4">
            <For each={Object.values(FEATURES)}>
              {(spec) => {
                const cfg = () => resolveFeatureConfig(spec.key as FeatureKey, state.userPreferences.features?.[spec.key])
                return (
                  <div class="flex flex-col gap-3 p-3 rounded-lg border border-[color-mix(in_oklch,var(--text),transparent_85%)]">
                    <label class="flex items-center gap-3">
                      <input
                        type="checkbox"
                        checked={cfg().enabled}
                        onChange={(e) => trpc.preferences.setFeature.mutate({ key: spec.key, enabled: e.currentTarget.checked })}
                      />
                      <span class="flex flex-col">
                        <Text><Em semibold>{spec.name}</Em></Text>
                        <Text size="sm" class="opacity-50">{spec.description}</Text>
                      </span>
                    </label>
                    <Show when={cfg().enabled}>
                      <div class="pl-7">
                        <SchemaForm
                          fields={spec.schema}
                          values={cfg().values}
                          onChange={(values) => trpc.preferences.setFeature.mutate({ key: spec.key, values })}
                        />
                      </div>
                    </Show>
                  </div>
                )
              }}
            </For>
          </div>
        </section>

        {/* Install as App (mobile only, hidden when already installed) */}
        <Show when={!isStandalone()}>
          <section class="mb-8 md:hidden">
            <Heading level={2} class="mb-4">Install</Heading>
            <div class="flex flex-col gap-2">
              <button
                type="button"
                disabled={!installAvailable()}
                class="p-3 rounded-lg bg-(--bg) border border-[color-mix(in_oklch,var(--text),transparent_85%)] hover:bg-[color-mix(in_oklch,var(--text),transparent_92%)] disabled:opacity-50 disabled:cursor-not-allowed text-left"
                onClick={() => { triggerInstall() }}
              >
                <Text><Em semibold>Install as App</Em></Text>
              </button>
              <Show when={!installAvailable()}>
                <Text size="sm" class="opacity-50">
                  Not available yet. Needs HTTPS, and the browser takes a moment to qualify the site — come back shortly. On iOS: Safari's Share menu → Add to Home Screen.
                </Text>
              </Show>
            </div>
          </section>
        </Show>

      </div>
    </div>
  )
}
