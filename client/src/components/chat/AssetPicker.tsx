import { createMemo, createSignal } from 'solid-js'
import { state } from '../../state'
import { trpc } from '../../trpc'
import { ActorList } from '../actors'
import { NoteList } from '../notes'
import type { Actor, Note } from '@shared/types'

function SearchInput(props: { placeholder: string; value: string; onInput: (v: string) => void }) {
    return (
        <input
            type="text"
            placeholder={props.placeholder}
            value={props.value}
            onInput={(e) => props.onInput(e.currentTarget.value)}
            class="p-2 rounded-lg bg-(--bg) border border-[color-mix(in_oklch,var(--text),transparent_85%)]"
            autofocus
        />
    )
}

export function ActorPicker(props: {
    /** Override the "already added" set. Defaults to state.currentChat.assets.actors. */
    selected?: () => Set<string>
    /** Override the toggle side-effect. If supplied, the picker skips the tRPC call. */
    onToggle?: (actor: Actor) => void
} = {}) {
    const [query, setQuery] = createSignal('')
    const added = () => props.selected?.() ?? new Set(state.currentChat?.assets?.actors ?? [])

    const items = createMemo<Actor[]>(() => {
        const q = query().toLowerCase().trim()
        return Object.values(state.assets.actors ?? {})
            .filter(a => !q
                || a.name.toLowerCase().includes(q)
                || a.description.toLowerCase().includes(q)
                || a.customId.toLowerCase().includes(q)
                || (a.group ?? '').toLowerCase().includes(q))
    })

    const toggle = async (actor: Actor) => {
        if (props.onToggle) {
            props.onToggle(actor)
            return
        }
        if (added().has(actor.id)) {
            await trpc.chat.removeActor.mutate({ actorId: actor.id })
        } else {
            await trpc.chat.addActor.mutate({ actorId: actor.id })
        }
    }

    return (
        <div class="flex flex-col gap-3 min-h-0 min-w-0 h-full w-full max-w-[520px]">
            <SearchInput placeholder="Search actors…" value={query()} onInput={setQuery} />
            <div class="overflow-y-auto flex-1 min-w-0">
                <ActorList
                    actors={items()}
                    onActorClick={toggle}
                    isSelected={(a) => added().has(a.id)}
                />
            </div>
        </div>
    )
}

/**
 * Single-select picker for the user's player character. Unlike the chat
 * actors/notes pickers (which toggle membership and stay open), this one
 * commits the selection on click. Includes a "None" row to clear the setting.
 */
export function PlayerCharacterPicker(props: { onPick?: () => void }) {
    const [query, setQuery] = createSignal('')
    const currentId = () => state.userPreferences.playerCharacterId

    const items = createMemo<Actor[]>(() => {
        const q = query().toLowerCase().trim()
        return Object.values(state.assets.actors ?? {})
            .filter(a => !q
                || a.name.toLowerCase().includes(q)
                || a.description.toLowerCase().includes(q)
                || a.customId.toLowerCase().includes(q))
    })

    const pick = async (actor: Actor) => {
        await trpc.preferences.update.mutate({ playerCharacterId: actor.id })
        props.onPick?.()
    }

    const clear = async () => {
        await trpc.preferences.update.mutate({ playerCharacterId: null })
        props.onPick?.()
    }

    return (
        <div class="flex flex-col gap-3 min-h-0 min-w-0 h-full w-full max-w-[520px]">
            <SearchInput placeholder="Search actors…" value={query()} onInput={setQuery} />
            <div class="overflow-y-auto flex-1 min-w-0 flex flex-col gap-2">
                <button
                    type="button"
                    onClick={clear}
                    class="text-left px-4 py-3 rounded-lg border border-[color-mix(in_oklch,var(--text),transparent_85%)] hover:bg-[color-mix(in_oklch,var(--text),transparent_92%)]"
                    classList={{ 'border-(--primary)': currentId() === null }}
                >
                    <span class="opacity-70">No player character</span>
                </button>
                <ActorList
                    actors={items()}
                    onActorClick={pick}
                    isSelected={(a) => a.id === currentId()}
                />
            </div>
        </div>
    )
}

export function NotePicker(props: {
    /** Override the "already added" set. Defaults to state.currentChat.assets.notes. */
    selected?: () => Set<string>
    /** Override the toggle side-effect. If supplied, the picker skips the tRPC call. */
    onToggle?: (note: Note) => void
} = {}) {
    const [query, setQuery] = createSignal('')
    const added = () => props.selected?.() ?? new Set(state.currentChat?.assets?.notes ?? [])

    const items = createMemo<Note[]>(() => {
        const q = query().toLowerCase().trim()
        return Object.values(state.assets.notes ?? {})
            .filter(n => !q
                || n.title.toLowerCase().includes(q)
                || n.type.toLowerCase().includes(q)
                || n.content.toLowerCase().includes(q))
    })

    const toggle = async (note: Note) => {
        if (props.onToggle) {
            props.onToggle(note)
            return
        }
        if (added().has(note.id)) {
            await trpc.chat.removeNote.mutate({ noteId: note.id })
        } else {
            await trpc.chat.addNote.mutate({ noteId: note.id })
        }
    }

    return (
        <div class="flex flex-col gap-3 min-h-0 min-w-0 h-full w-full max-w-[520px]">
            <SearchInput placeholder="Search notes…" value={query()} onInput={setQuery} />
            <div class="overflow-y-auto flex-1 min-w-0">
                <NoteList
                    notes={items()}
                    onNoteClick={toggle}
                    isSelected={(n) => added().has(n.id)}
                />
            </div>
        </div>
    )
}
