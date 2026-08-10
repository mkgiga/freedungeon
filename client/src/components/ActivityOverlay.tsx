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

    /**
     * Either shape of progress: a 0..1 fraction (per-job, from Forge's
     * /internal/progress) or a step pair. A queued job reports neither, because
     * it hasn't started — no bar is honest there, a 0% one looks stalled.
     */
    const percent = (): number | null => {
        const d = data()
        if (typeof d.progress === 'number') return Math.round(Math.max(0, Math.min(1, d.progress)) * 100)
        if (typeof d.currentStep === 'number' && typeof d.steps === 'number') {
            return Math.round((d.currentStep / Math.max(1, d.steps)) * 100)
        }
        return null
    }

    return (
        <div class="activity-row">
            <span class="activity-spinner" aria-hidden="true" />
            <div class="activity-body">
                <Text size="sm">{describe(props.activity)}</Text>
                <Show when={percent() !== null}>
                    <div class="activity-progress">
                        <div class="activity-progress-fill" style={{ width: `${percent()}%` }} />
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
            if (data.phase === 'removingBackground') return `Removing background for ${data.label ?? 'item'}…`
            // Forge runs one generation at a time, so icons behind another job
            // are genuinely waiting rather than running slowly.
            if (data.queued) return `Waiting to generate icon for ${data.label ?? 'item'}…`
            return `Generating icon for ${data.label ?? 'item'}…`
        case 'generatingImage':
            return `Generating ${data.aspect ?? ''} image…`.replace('  ', ' ')
        default:
            return String(data.label ?? activity.kind)
    }
}
