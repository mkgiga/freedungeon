
import type { AppState } from '@shared/types'

type Store = AppState
type Apply = {
    set: (root: 'actors' | 'notes' | 'chats', id: string, value: unknown) => void
    remove: (root: 'actors' | 'notes' | 'chats', id: string) => void
}

const RULES: Record<string, (id: string, state: Store, apply: Apply) => void> = {
    chats: (chatId, state, apply) => {
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
        for (const other of Object.values(state.assets.chats)) {
            if (other.id !== chatId && other.homeChatId === chatId) {
                apply.remove('chats', other.id)
            }
        }
    },

    actors: (actorId, state, apply) => {
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
