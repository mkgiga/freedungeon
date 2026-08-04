import { createSignal, For, Show } from 'solid-js'
import { Portal } from 'solid-js/web'
import { state } from '../state'
import { trpc } from '../trpc'
import { LLM_PRESETS } from '@shared/llm-presets'
import { Heading } from './typography/Heading'
import { Text } from './typography/Text'
import { Em } from './typography/Em'

/**
 * First-run setup. Blocks the app until the user has an LLM config or
 * explicitly skips, because without one nothing in freedungeon does anything —
 * and the place to create one is a screen the user has no reason to visit yet.
 *
 * Shown purely off `userPreferences.onboardingCompletedAt`; see the note on
 * that field for why it isn't inferred from whether configs exist.
 *
 * Mounted alongside PatcherOverlay in app.tsx. The patcher sits above this one,
 * which is what you want: picking Anthropic here kicks off the Claude Code
 * download, and that progress needs to be visible over the top.
 */
/**
 * First-run copy for the presets, kept here rather than on the presets
 * themselves: at this point the user is picking a *provider*, not a model, so
 * "Claude Opus 4.7" and an endpoint URL are detail they can't act on yet. Both
 * are editable straight afterwards. Unknown keys fall back to the preset's own
 * name, so adding a preset degrades gracefully instead of rendering blank.
 */
const CHOICES: Record<string, { label: string; hint?: string }> = {
    'openai-gpt4o': { label: 'OpenAI' },
    'anthropic-claude': { label: 'Claude' },
    'gemini-2.5-pro': { label: 'Google Gemini' },
    'openai-compatible': {
        label: 'Custom (OpenAI-compatible)',
        hint: 'Pick this to connect a local model — llama.cpp, Ollama, LM Studio, KoboldCpp.',
    },
}

export function OnboardingOverlay() {
    const [busy, setBusy] = createSignal(false)
    const [error, setError] = createSignal<string | null>(null)

    const needed = () => !state.userPreferences.onboardingCompletedAt

    const complete = () => trpc.preferences.update.mutate({ onboardingCompletedAt: Date.now() })

    const choose = async (presetKey: string) => {
        setBusy(true)
        setError(null)
        try {
            // Saving an Anthropic config can block on the CLI download and
            // sign-in, and refuses outright if those fail — so only mark
            // onboarding done once we actually have a config.
            const config = await trpc.llmConfigs.createFromPreset.mutate({ presetKey })
            await trpc.preferences.update.mutate({
                activeLLMConfigId: config.id,
                onboardingCompletedAt: Date.now(),
            })
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err))
        } finally {
            setBusy(false)
        }
    }

    let panel: HTMLDivElement | undefined

    /**
     * Clicking the backdrop does nothing, which on its own reads as the app
     * being broken. Shake the panel instead so the refusal is legible.
     *
     * The class is removed and re-added around a forced reflow because a CSS
     * animation won't restart just by re-applying its class — an impatient
     * second click would otherwise get no feedback at all.
     */
    const refuseDismiss = () => {
        if (!panel) return
        panel.classList.remove('is-refusing')
        void panel.offsetWidth
        panel.classList.add('is-refusing')
    }

    return (
        <Show when={needed()}>
            <Portal>
                <div
                    class="onboarding-overlay"
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

                        {/* Dismisses on one click. Accidental dismissal is still
                            guarded against by the overlay itself, which has no
                            click-outside and no Escape handler — so this is a
                            deliberate press, and doesn't need confirming. */}
                        <div class="onboarding-actions">
                            <button class="onboarding-skip" disabled={busy()} onClick={complete}>
                                Skip for now
                            </button>
                        </div>
                    </div>
                </div>
            </Portal>
        </Show>
    )
}
