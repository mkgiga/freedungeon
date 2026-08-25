import { For, Show } from 'solid-js'
import { state } from '../../state'
import { useModal } from '../Modal'
import { Text } from '../typography/Text'

function DebugPromptView() {
    const lp = () => state.currentChat.lastPrompt

    const contextLabel = (p: NonNullable<ReturnType<typeof lp>>) =>
        p.rehydratedFromLog
            ? 'rehydrated from message log'
            : p.resumedSessionId
                ? `resumed session ${p.resumedSessionId}`
                : 'fresh'

    return (
        <div class="flex flex-col gap-3 overflow-y-auto p-1" style={{ 'max-height': '100%' }}>
            <Show
                when={lp()}
                fallback={
                    <Text size="sm" class="opacity-60">
                        Nothing captured yet — send a message.
                    </Text>
                }
            >
                {(p) => (
                    <>
                        <div class="flex flex-wrap items-center gap-x-2 gap-y-1 opacity-70">
                            <Text size="sm" font="mono">{p().provider}</Text>
                            <span class="opacity-40">·</span>
                            <Text size="sm" font="mono">{p().model}</Text>
                            <span class="opacity-40">·</span>
                            <Text size="sm" font="mono">{p().loop}</Text>
                            <span class="opacity-40">·</span>
                            <Text size="sm">{contextLabel(p())}</Text>
                            <span class="opacity-40">·</span>
                            <Text size="sm">{new Date(p().capturedAt).toLocaleTimeString()}</Text>
                        </div>

                        <details class="rounded border border-[color-mix(in_oklch,var(--text),transparent_85%)]">
                            <summary class="cursor-pointer select-none px-2 py-1 opacity-80">
                                <Text size="sm" class="inline">System prompt ({p().systemPrompt.length} chars)</Text>
                            </summary>
                            <Text
                                size="sm"
                                font="mono"
                                class="block px-2 py-2 whitespace-pre-wrap break-words opacity-90"
                            >
                                {p().systemPrompt || '(empty)'}
                            </Text>
                        </details>

                        <Text size="sm" class="opacity-60">
                            History ({p().messages.length} message{p().messages.length === 1 ? '' : 's'})
                        </Text>
                        <div class="flex flex-col gap-2">
                            <For each={p().messages}>
                                {(m, i) => (
                                    <div class="rounded border border-[color-mix(in_oklch,var(--text),transparent_88%)]">
                                        <div class="flex items-center gap-2 px-2 py-1 border-b border-[color-mix(in_oklch,var(--text),transparent_92%)]">
                                            <span class="rounded px-1.5 py-0.5 text-xs font-mono uppercase opacity-80 bg-[color-mix(in_oklch,var(--text),transparent_88%)]">
                                                {m.role}
                                            </span>
                                            <Text size="sm" class="opacity-40">#{i() + 1}</Text>
                                        </div>
                                        <Text
                                            size="sm"
                                            font="mono"
                                            class="block px-2 py-2 whitespace-pre-wrap break-words opacity-90"
                                        >
                                            {m.content || '(empty)'}
                                        </Text>
                                    </div>
                                )}
                            </For>
                        </div>
                    </>
                )}
            </Show>
        </div>
    )
}

export function useDebugPrompt() {
    const modal = useModal()

    return () => modal.open({
        title: 'Prompt sent to provider',
        fullscreen: true,
        content: () => <DebugPromptView />,
    })
}
