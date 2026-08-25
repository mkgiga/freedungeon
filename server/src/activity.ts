
import { nanoid } from 'nanoid'
import { mutate, state } from './server'
import type { Activity } from '@shared/types'

/**
 * Announce the start of a unit of work. Returns its id, for `updateActivity` /
 * `endActivity`. Prefer `withActivity` where the work is a single awaited call
 * — it cannot leak an activity on the error path.
 */
export function beginActivity(kind: string, data: Record<string, unknown> = {}): string {
    const id = nanoid()
    const activity: Activity = { id, kind, startedAt: Date.now(), data }
    mutate(s => { s.activities[id] = activity })
    return id
}

/**
 * Merge fields into a running activity's `data`. No-op if the activity has
 * already ended, so a late progress update racing `endActivity` cannot
 * resurrect a finished entry as a permanent ghost in the UI.
 */
export function updateActivity(id: string, patch: Record<string, unknown>): void {
    const current = state.activities[id]
    if (!current) return
    mutate(s => { s.activities[id]!.data = { ...current.data, ...patch } })
}

export function endActivity(id: string): void {
    if (!state.activities[id]) return
    mutate(s => { delete s.activities[id] })
}

/**
 * Run `fn` bracketed by an activity. The `finally` is the point: a throw or an
 * abort still clears the activity, so a failed image generation can't leave a
 * spinner on screen forever.
 */
export async function withActivity<T>(
    kind: string,
    data: Record<string, unknown>,
    fn: (update: (patch: Record<string, unknown>) => void) => Promise<T>,
): Promise<T> {
    const id = beginActivity(kind, data)
    try {
        return await fn((patch) => updateActivity(id, patch))
    } finally {
        endActivity(id)
    }
}
