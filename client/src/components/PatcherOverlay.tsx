import { createMemo, For, Show } from 'solid-js'
import { Portal } from 'solid-js/web'
import { state } from '../state'
import { trpc } from '../trpc'
import { isBlocking, type DependencyState } from '@shared/dependencies'
import { Heading } from './typography/Heading'
import { Text } from './typography/Text'

/**
 * Blocks the app while a required external file is being fetched.
 *
 * Driven entirely by the replicated `state.dependencies` map — the same one-way
 * flow as ActivityOverlay. The client never polls; the server publishes
 * progress and this re-renders. Mounted at the app shell rather than inside a
 * route so it covers every tab.
 *
 * A failed download keeps the overlay up with Retry/Cancel rather than
 * vanishing, because the action that triggered it (saving an Anthropic config,
 * enabling background removal) is refused when the dependency can't be met —
 * silently dismissing would leave the user wondering why nothing saved.
 */
export function PatcherOverlay() {
    const blocking = createMemo(() =>
        Object.values(state.dependencies ?? {}).filter(isBlocking),
    )

    return (
        <Show when={blocking().length > 0}>
            <Portal>
                <div class="patcher-overlay">
                    <div class="patcher-panel">
                        <Heading level={2}>Downloading required files</Heading>
                        <For each={blocking()}>{(dep) => <PatcherRow dep={dep} />}</For>
                    </div>
                </div>
            </Portal>
        </Show>
    )
}

function PatcherRow(props: { dep: DependencyState }) {
    const pct = () => {
        const { received, total } = props.dep
        if (!total || !received) return null
        return Math.min(100, Math.round((received / total) * 100))
    }

    return (
        <div class="patcher-row">
            <Text>{props.dep.label}</Text>
            <Text size="sm" class="patcher-reason">{props.dep.reason}</Text>

            <Show when={props.dep.status === 'downloading'}>
                <div class="patcher-progress">
                    <div
                        class="patcher-progress-fill"
                        classList={{ indeterminate: pct() === null }}
                        style={pct() !== null ? { width: `${pct()}%` } : undefined}
                    />
                </div>
                <Text size="sm" class="patcher-bytes">
                    {pct() !== null ? `${pct()}% — ${mb(props.dep.received)} of ${mb(props.dep.total)}` : mb(props.dep.received)}
                </Text>
            </Show>

            <Show when={props.dep.status === 'failed'}>
                <Text size="sm" class="patcher-error">{props.dep.error ?? 'Download failed.'}</Text>
                <div class="patcher-actions">
                    <button
                        class="modal-btn modal-btn-confirm"
                        onClick={() => trpc.dependencies.ensure.mutate({ key: props.dep.key })}
                    >
                        Retry
                    </button>
                    <button
                        class="modal-btn modal-btn-cancel"
                        onClick={() => trpc.dependencies.dismiss.mutate({ key: props.dep.key })}
                    >
                        Cancel
                    </button>
                </div>
            </Show>
        </div>
    )
}

function mb(bytes: number | undefined): string {
    if (!bytes) return '0 MB'
    return `${(bytes / 1e6).toFixed(1)} MB`
}
