import { createMemo } from 'solid-js'
import { state } from '../../state'
import { trpc } from '../../trpc'
import { MdFillAdd, MdFillPerson_add } from 'solid-icons/md'
import { Heading } from '../typography/Heading'
import { ActorList } from '../actors'
import { NoteList } from '../notes'
import { useModal } from '../Modal'
import { ActorPicker, NotePicker } from './AssetPicker'
import type { Actor, Note } from '@shared/types'

export function ChatSidebar() {
    const modal = useModal()

    const chatActors = createMemo<Actor[]>(() => {
        const actorIds = state.currentChat?.assets?.actors ?? []
        return actorIds
            .map((id) => state.assets.actors?.[id])
            .filter((a): a is Actor => Boolean(a))
    })

    const chatNotes = createMemo<Note[]>(() => {
        const noteIds = state.currentChat?.assets?.notes ?? []
        return noteIds
            .map((id) => state.assets.notes?.[id])
            .filter((n): n is Note => Boolean(n))
    })

    const openActorPicker = () => {
        modal.open({
            title: 'Add actors',
            content: () => <ActorPicker />,
        })
    }

    const openNotePicker = () => {
        modal.open({
            title: 'Add notes',
            content: () => <NotePicker />,
        })
    }

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
                        actions={[
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
