import { nanoid } from 'nanoid'
import { mutate, state } from '../server'
import { log } from '../logger'
import type { ExtensionHold } from '@shared/extensions'

/**
 * Turn holds: an extension saying "not yet" to the next turn.
 *
 * Deliberately shaped like `activity.ts`, because it is the same kind of
 * bookkeeping - a record keyed by id, replicated, cleared by whoever opened it.
 * The two are orthogonal: an Activity draws a spinner and gates nothing, a hold
 * gates and draws nothing. Work that should do both takes both.
 *
 * Prefer `holdWhile` where the wait is a single awaited call - its `finally`
 * cannot leak a hold on the error path, and a leaked hold is the one failure
 * here the user would feel as the app being broken.
 */
export function beginHold(extension: string, reason: string): string {
    const id = nanoid()
    const hold: ExtensionHold = { id, extension, reason, startedAt: Date.now() }
    mutate(s => { s.extensionHolds[id] = hold })
    log.server.info(`[ext:${extension}] holding the next turn: ${reason}`)
    return id
}

export function endHold(id: string): void {
    const hold = state.extensionHolds[id]
    if (!hold) return
    mutate(s => { delete s.extensionHolds[id] })
    log.server.info(`[ext:${hold.extension}] released the turn`)
}

/**
 * The `finally` is the point: a throw or an abort still releases the turn, so a
 * failure inside an extension can't leave the composer refusing forever.
 */
export async function holdWhile<T>(
    extension: string,
    reason: string,
    fn: () => Promise<T>,
): Promise<T> {
    const id = beginHold(extension, reason)
    try {
        return await fn()
    } finally {
        endHold(id)
    }
}

/**
 * Called when an extension stops, whether it was switched off, uninstalled or
 * replaced. An extension that is no longer running cannot be waiting for
 * anything, so its holds go with it - which is also the user's way out of one
 * that was never released.
 */
export function releaseHoldsOf(extension: string): void {
    const mine = Object.values(state.extensionHolds).filter(h => h.extension === extension)
    if (mine.length === 0) return
    mutate(s => { for (const hold of mine) delete s.extensionHolds[hold.id] })
    log.server.info(`[ext:${extension}] ${mine.length} hold(s) released with the extension`)
}
