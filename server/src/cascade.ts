/**
 * What else has to happen in memory when an entity is deleted.
 *
 * The database has foreign keys that cascade and set-null correctly, but they
 * act on a *projection*: at runtime the Solid store is the source of truth and
 * SQL is written out of it by `persistPath`. Nothing reads back from SQLite
 * except at boot, and bun:sqlite exposes no change hook — so a constraint
 * firing in the database is invisible to the application, and the next write of
 * that entity overwrites whatever it did.
 *
 * Three separate bugs came from that gap before this file existed:
 *
 *   - deleting an actor left its id in every chat's `assets.actors`, so the
 *     next `saveChat` re-inserted a ref to a missing row and threw
 *     FOREIGN KEY constraint failed on every subsequent save
 *   - deleting a Scenario left its residents' `homeChatId` pointing at it, so
 *     they stayed invisible in the library until a restart
 *   - deleting a Scenario left its collaborator conversation in the store
 *
 * Each was found by a test and fixed at its own call site. Declaring them here
 * instead means the invariant is stated once, and a new delete path gets it for
 * free rather than having to remember.
 *
 * These run BEFORE the entity is removed, so a rule can still read it.
 */

import type { AppState } from '@shared/types'

type Store = AppState
type Apply = {
    /** Replace an entity in place. */
    set: (root: 'actors' | 'notes' | 'chats', id: string, value: unknown) => void
    /** Remove an entity, running its own cascades in turn. */
    remove: (root: 'actors' | 'notes' | 'chats', id: string) => void
}

/** Rules keyed by the asset root being deleted from. */
const RULES: Record<string, (id: string, state: Store, apply: Apply) => void> = {
    chats: (chatId, state, apply) => {
        // Residents are evicted, not deleted: an actor that outlives its
        // Scenario is still a useful actor. Mirrors ON DELETE SET NULL.
        for (const actor of Object.values(state.assets.actors)) {
            if (actor.homeChatId === chatId) {
                apply.set('actors', actor.id, { ...actor, homeChatId: null })
            }
        }
        for (const note of Object.values(state.assets.notes)) {
            if (note.homeChatId === chatId) {
                apply.set('notes', note.id, { ...note, homeChatId: null })
            }
        }
        // Collaborator conversations belong to the chat and go with it, which
        // deliberately inverts the eviction rule above. Mirrors ON DELETE
        // CASCADE.
        for (const other of Object.values(state.assets.chats)) {
            if (other.id !== chatId && other.homeChatId === chatId) {
                apply.remove('chats', other.id)
            }
        }
    },

    actors: (actorId, state, apply) => {
        // Only reachable via a hard delete — the actors router soft-deletes, so
        // in normal operation the row survives and history keeps resolving it.
        // Kept because a future purge would otherwise resurrect the original
        // dangling-ref bug.
        for (const chat of Object.values(state.assets.chats)) {
            if (!chat.assets.actors.includes(actorId)) continue
            apply.set('chats', chat.id, {
                ...chat,
                assets: { ...chat.assets, actors: chat.assets.actors.filter(a => a !== actorId) },
            })
        }
    },

    notes: (noteId, state, apply) => {
        for (const chat of Object.values(state.assets.chats)) {
            if (!chat.assets.notes[noteId]) continue
            const notes = Object.fromEntries(
                Object.entries(chat.assets.notes).filter(([id]) => id !== noteId),
            )
            apply.set('chats', chat.id, { ...chat, assets: { ...chat.assets, notes } })
        }
    },
}

/**
 * Run the cascades for `path`, if it names an asset. Called from deleteState
 * before the entity is removed.
 *
 * Only `['assets', <root>, <id>]` triggers rules — deleting a nested field
 * (an expression, a note ref) is not an entity deletion and has no cascade.
 */
export function applyDeleteCascades(path: string[], state: Store, apply: Apply): void {
    if (path.length !== 3 || path[0] !== 'assets') return
    const rule = RULES[path[1]!]
    if (!rule) return
    rule(path[2]!, state, apply)
}
