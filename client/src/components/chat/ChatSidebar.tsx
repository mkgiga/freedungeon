import { createMemo } from 'solid-js'
import { state } from '../../state'
import { trpc } from '../../trpc'
import { MdFillAdd, MdFillPerson_add } from 'solid-icons/md'
import { Heading } from '../typography/Heading'
import { ActorList } from '../actors'
import { NoteList } from '../notes'
import { useModal } from '../Modal'
import { useResourceEditors } from '../ResourceEditors'
import { ActorPicker, NotePicker } from './AssetPicker'
import type { Actor, Note } from '@shared/types'
import { visible } from '@shared/visibility'

export function ChatSidebar() {
    const modal = useModal()
    const editors = useResourceEditors()

    const isNoteEnabled = (note: Note) =>
        state.currentChat.assets.notes[note.id]?.enabled ?? true

    const setNoteEnabled = (note: Note, enabled: boolean) =>
        trpc.chat.setNoteEnabled.mutate({ noteId: note.id, enabled })

    const chatActors = createMemo<Actor[]>(() => {
        const actorIds = state.currentChat?.assets?.actors ?? []
        return visible(actorIds
            .map((id) => state.assets.actors?.[id])
            .filter((a): a is Actor => Boolean(a)))
    })

    const chatNotes = createMemo<Note[]>(() => {
        const noteIds = Object.keys(state.currentChat?.assets?.notes ?? {})
        return visible(noteIds
            .map((id) => state.assets.notes?.[id])
            .filter((n): n is Note => Boolean(n)))
    })

    // Actors and notes are part of the system prompt, so changing the set
    // rewrites the prefix every provider caches on. Measured: the next turn
    // reprocesses the whole prompt instead of ~5% of it. Only worth mentioning
    // once a chat has history - there is nothing cached to lose before that.
    const warnThenOpen = (message: string, open: () => void) => {
        if (Object.keys(state.currentChat.messages ?? {}).length === 0) { open(); return }
        modal.confirm({ title: 'Just so you know', message, onConfirm: open })
    }

    const openActorPicker = () => warnThenOpen(
        'Changing who is in this chat makes the next reply slower. After that it is back to normal.',
        () => modal.open({ title: 'Add actors', content: () => <ActorPicker /> }),
    )

    const openNotePicker = () => warnThenOpen(
        'Changing the notes here makes the next reply slower. After that it is back to normal.',
        () => modal.open({ title: 'Add notes', content: () => <NotePicker /> }),
    )

    return (
        <div class="chat-sidebar">
            <section class="chat-sidebar-section">
                <header class="chat-sidebar-section-header">
                    <Heading level={2}>Participants</Heading>
                    <button onClick={openActorPicker} title="Add participant">
                        <MdFillPerson_add size={18} />
                    </button>
                </header>
                <div class="chat-sidebar-section-body">
                    <ActorList
                        actors={chatActors()}
                        hideHeader
                        actions={[
                            {
                                label: 'Remove',
                                danger: true,
                                callback: (actor) => trpc.chat.removeActor.mutate({ actorId: actor.id }),
                            },
                        ]}
                    />
                </div>
            </section>

            <section class="chat-sidebar-section">
                <header class="chat-sidebar-section-header">
                    <Heading level={2}>Active Notes</Heading>
                    <button onClick={openNotePicker} title="Add note">
                        <MdFillAdd size={18} />
                    </button>
                </header>
                <div class="chat-sidebar-section-body">
                    <NoteList
                        notes={chatNotes()}
                        showType={false}
                        hideHeader
                        onNoteClick={editors.openNote}
                        disabled={(note) => !isNoteEnabled(note)}
                        actions={[
                            {
                                label: 'Disable',
                                show: isNoteEnabled,
                                callback: (note) => setNoteEnabled(note, false),
                            },
                            {
                                label: 'Enable',
                                show: (note) => !isNoteEnabled(note),
                                callback: (note) => setNoteEnabled(note, true),
                            },
                            {
                                label: 'Remove',
                                danger: true,
                                callback: (note) => trpc.chat.removeNote.mutate({ noteId: note.id }),
                            },
                        ]}
                    />
                </div>
            </section>
        </div>
    )
}
