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
export function OnboardingOverlay() {
    const [busy, setBusy] = createSignal(false)
    const [error, setError] = createSignal<string | null>(null)
    const [confirmingSkip, setConfirmingSkip] = createSignal(false)

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

    return (
        <Show when={needed()}>
            <Portal>
                <div class="onboarding-overlay">
                    <div class="onboarding-panel">
                        <Heading level={2}>Welcome to freedungeon</Heading>
                        <Text size="sm" class="onboarding-lede">
                            A roleplaying game where the dungeon master is a language model. You bring
                            the model — freedungeon handles the characters, inventory, scenes and story.
                        </Text>

                        <Text size="sm" class="onboarding-step">
                            Pick where your model runs. You can change or add more later in Preferences.
                        </Text>

                        <div class="onboarding-presets">
                            <For each={Object.entries(LLM_PRESETS)}>
                                {([key, preset]) => (
                                    <button
                                        class="onboarding-preset"
                                        disabled={busy()}
                                        onClick={() => choose(key)}
                                    >
                                        <Text><Em semibold>{preset.name}</Em></Text>
                                        <Text size="sm" class="opacity-50">{preset.endpoint}</Text>
                                    </button>
                                )}
                            </For>
                        </div>

                        <Show when={error()}>
                            <Text size="sm" class="onboarding-error">{error()}</Text>
                        </Show>

                        {/* Two-step on purpose. There is no click-outside and no
                            Escape handler here — this is a bare portal rather
                            than a ModalProvider modal — so the only way out is
                            deliberate, and the one escape hatch takes a
                            confirmation rather than a single stray click. */}
                        <div class="onboarding-actions">
                            <Show
                                when={confirmingSkip()}
                                fallback={
                                    <button
                                        class="onboarding-skip"
                                        disabled={busy()}
                                        onClick={() => setConfirmingSkip(true)}
                                    >
                                        Skip for now
                                    </button>
                                }
                            >
                                <Text size="sm" class="onboarding-skip-warning">
                                    Without a model, chats can't generate anything. You can set one up
                                    later under Preferences.
                                </Text>
                                <div class="onboarding-skip-actions">
                                    <button class="modal-btn modal-btn-cancel" onClick={() => setConfirmingSkip(false)}>
                                        Go back
                                    </button>
                                    <button class="modal-btn modal-btn-confirm" disabled={busy()} onClick={complete}>
                                        Skip anyway
                                    </button>
                                </div>
                            </Show>
                        </div>
                    </div>
                </div>
            </Portal>
        </Show>
    )
}
