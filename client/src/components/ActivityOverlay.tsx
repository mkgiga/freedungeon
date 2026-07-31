import { createMemo, For, Show } from 'solid-js'
import { state } from '../state'
import type { Activity } from '@shared/types'
import { Text } from './typography/Text'

/**
 * Renders whatever server-side work is currently in flight. Driven entirely by
 * the replicated `state.activities` map — the client never asks for this, it
 * just re-renders when the server sets or deletes an entry.
 *
 * Add a new activity by adding a `kind` case here; anything unrecognised falls
 * back to a plain labelled row, so a server can emit a new kind without the UI
 * needing to ship first.
 */
export function ActivityOverlay() {
    const activities = createMemo(() =>
        Object.values(state.activities ?? {}).sort((a, b) => a.startedAt - b.startedAt),
    )

    return (
        <Show when={activities().length > 0}>
            <div class="activity-overlay">
                <For each={activities()}>{(activity) => <ActivityRow activity={activity} />}</For>
            </div>
        </Show>
    )
}

function ActivityRow(props: { activity: Activity }) {
    const data = () => props.activity.data as Record<string, any>

    return (
        <div class="activity-row">
            <span class="activity-spinner" aria-hidden="true" />
            <div class="activity-body">
                <Text size="sm">{describe(props.activity)}</Text>
                <Show when={typeof data().currentStep === 'number' && typeof data().steps === 'number'}>
                    <div class="activity-progress">
                        <div
                            class="activity-progress-fill"
                            style={{ width: `${Math.round((data().currentStep / Math.max(1, data().steps)) * 100)}%` }}
                        />
                    </div>
                </Show>
            </div>
            <Show when={data().preview}>
                {(preview) => <img class="activity-preview" src={preview()} alt="" />}
            </Show>
        </div>
    )
}

function describe(activity: Activity): string {
    const data = activity.data as Record<string, any>
    switch (activity.kind) {
        case 'generatingItemIcon':
            return data.phase === 'removingBackground'
                ? `Removing background for ${data.label ?? 'item'}…`
                : `Generating icon for ${data.label ?? 'item'}…`
        case 'generatingImage':
            return `Generating ${data.aspect ?? ''} image…`.replace('  ', ' ')
        default:
            return String(data.label ?? activity.kind)
    }
}
