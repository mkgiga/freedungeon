import { createSignal, For, Show } from 'solid-js'
import { Portal } from 'solid-js/web'
import { hydrated, state } from '../state'
import { trpc } from '../trpc'
import { LLM_PRESETS } from '@shared/llm-presets'
import { setPendingConfigEdit } from '../pending-nav'
import { useLlmConfigs } from './LlmConfigsDialog'
import { Heading } from './typography/Heading'
import { Text } from './typography/Text'
import { Em } from './typography/Em'

const CHOICES: Record<string, { label: string; hint?: string }> = {
    'openai-gpt4o': { label: 'OpenAI' },
    'anthropic-claude': { label: 'Claude' },
    'openai-compatible': {
        label: 'Custom (OpenAI-compatible)',
        hint: 'For local models — Ollama, LM Studio, llama.cpp, KoboldCpp.',
    },
}

export function OnboardingOverlay() {
    const [busy, setBusy] = createSignal(false)
    const [error, setError] = createSignal<string | null>(null)
    const configs = useLlmConfigs()

    const needed = () => hydrated() && !state.userPreferences.onboardingCompletedAt

    const complete = () => trpc.preferences.update.mutate({ onboardingCompletedAt: Date.now() })

    const choose = async (presetKey: string) => {
        setBusy(true)
        setError(null)
        try {
            const config = await trpc.llmConfigs.createFromPreset.mutate({ presetKey })
            await trpc.preferences.update.mutate({
                activeLLMConfigId: config.id,
                onboardingCompletedAt: Date.now(),
            })

            setPendingConfigEdit({
                id: config.id,
                focusEndpoint: LLM_PRESETS[presetKey]?.editable === true,
            })
            configs.open(config.id)
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err))
        } finally {
            setBusy(false)
        }
    }

    let panel: HTMLDivElement | undefined

    const refuseDismiss = () => {
        if (!panel) return
        panel.classList.remove('is-refusing')
        void panel.offsetWidth
        panel.classList.add('is-refusing')
    }

    return (
        <Portal>
            <div
                class="onboarding-overlay fade"
                classList={{ 'is-hidden': !needed() }}
                aria-hidden={!needed()}
                onMouseDown={(e) => { if (e.target === e.currentTarget) refuseDismiss() }}
            >
                <div
                    class="onboarding-panel"
                    ref={panel}
                    onAnimationEnd={() => panel?.classList.remove('is-refusing')}
                >
                    <Heading level={2}>Welcome to freedungeon</Heading>
                    <Text size="sm" class="onboarding-lede">
                        Roleplaying with a language model as the dungeon master.
                    </Text>

                    <Text size="sm" class="onboarding-step">
                        Where should it run? You can change this later.
                    </Text>

                    <div class="onboarding-presets">
                        <For each={Object.entries(LLM_PRESETS)}>
                            {([key, preset]) => (
                                <button
                                    class="onboarding-preset"
                                    disabled={busy()}
                                    onClick={() => choose(key)}
                                >
                                    <Text><Em semibold>{CHOICES[key]?.label ?? preset.name}</Em></Text>
                                    <Show when={CHOICES[key]?.hint}>
                                        {(hint) => <Text size="sm" class="opacity-50">{hint()}</Text>}
                                    </Show>
                                </button>
                            )}
                        </For>
                    </div>

                    <Show when={error()}>
                        <Text size="sm" class="onboarding-error">{error()}</Text>
                    </Show>

                    <div class="onboarding-actions">
                        <button class="onboarding-skip" disabled={busy()} onClick={complete}>
                            Skip for now
                        </button>
                    </div>
                </div>
            </div>
        </Portal>
    )
}
