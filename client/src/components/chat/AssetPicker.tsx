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

export function ActorPicker() {
    const [query, setQuery] = createSignal('')
    const added = () => new Set(state.currentChat?.assets?.actors ?? [])

    const items = createMemo<Actor[]>(() => {
        const q = query().toLowerCase().trim()
        return Object.values(state.assets.actors ?? {})
            .filter(a => !q
                || a.name.toLowerCase().includes(q)
                || a.description.toLowerCase().includes(q)
                || a.customId.toLowerCase().includes(q))
    })

    const toggle = async (actor: Actor) => {
        if (added().has(actor.id)) {
            await trpc.chat.removeActor.mutate({ actorId: actor.id })
        } else {
            await trpc.chat.addActor.mutate({ actorId: actor.id })
        }
    }

    return (
        <div class="flex flex-col gap-3 min-h-0 h-full" style={{ 'min-width': 'min(560px, 90vw)' }}>
            <SearchInput placeholder="Search actors…" value={query()} onInput={setQuery} />
            <div class="overflow-y-auto flex-1">
                <ActorList
                    actors={items()}
                    onActorClick={toggle}
                    isSelected={(a) => added().has(a.id)}
                />
            </div>
        </div>
    )
}

export function NotePicker() {
    const [query, setQuery] = createSignal('')
    const added = () => new Set(state.currentChat?.assets?.notes ?? [])

    const items = createMemo<Note[]>(() => {
        const q = query().toLowerCase().trim()
        return Object.values(state.assets.notes ?? {})
            .filter(n => !q
                || n.title.toLowerCase().includes(q)
                || n.type.toLowerCase().includes(q)
                || n.content.toLowerCase().includes(q))
    })

    const toggle = async (note: Note) => {
        if (added().has(note.id)) {
            await trpc.chat.removeNote.mutate({ noteId: note.id })
        } else {
            await trpc.chat.addNote.mutate({ noteId: note.id })
        }
    }

    return (
        <div class="flex flex-col gap-3 min-h-0 h-full" style={{ 'min-width': 'min(560px, 90vw)' }}>
            <SearchInput placeholder="Search notes…" value={query()} onInput={setQuery} />
            <div class="overflow-y-auto flex-1">
                <NoteList
                    notes={items()}
                    onNoteClick={toggle}
                    isSelected={(n) => added().has(n.id)}
                />
            </div>
        </div>
    )
}
