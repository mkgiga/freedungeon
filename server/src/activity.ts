
import { nanoid } from 'nanoid'
import { mutate, state } from './server'
import type { Activity } from '@shared/types'

/**
 * Prefer `withActivity` where the work is a single awaited call - it cannot
 * leak an activity on the error path.
 */
export function beginActivity(kind: string, data: Record<string, unknown> = {}): string {
    const id = nanoid()
    const activity: Activity = { id, kind, startedAt: Date.now(), data }
    mutate(s => { s.activities[id] = activity })
    return id
}

/**
 * No-op once the activity has ended, so a late progress update racing
 * `endActivity` can't resurrect it as a permanent ghost in the UI.
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
 * The `finally` is the point: a throw or an abort still clears the activity, so
 * a failure can't leave a spinner on screen forever.
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
