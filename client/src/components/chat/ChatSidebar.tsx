import { createMemo } from 'solid-js'
import { state } from '../../state'
import { MdFillAdd, MdFillPerson_add } from 'solid-icons/md'
import { Heading } from '../typography/Heading'
import { ActorList } from '../actors'
import { NoteList } from '../notes'
import type { Actor, Note } from '@shared/types'

export function ChatSidebar() {
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

    return (
        <div class="chat-sidebar">
            <section class="chat-sidebar-section">
                <header class="chat-sidebar-section-header">
                    <Heading level={2}>Participants</Heading>
                    <button onClick={() => console.log('[ChatSidebar] add participant')} title="Add participant">
                        <MdFillPerson_add size={18} />
                    </button>
                </header>
                <div class="chat-sidebar-section-body">
                    <ActorList
                        actors={chatActors()}
                        onActorClick={(actor) => console.log('[ChatSidebar] view actor', actor)}
                        actions={[
                            {
                                label: 'View',
                                callback: (actor) => console.log('[ChatSidebar] view actor', actor),
                            },
                            {
                                label: 'Remove',
                                danger: true,
                                callback: (actor) => console.log('[ChatSidebar] remove actor', actor),
                            },
                        ]}
                    />
                </div>
            </section>

            <section class="chat-sidebar-section">
                <header class="chat-sidebar-section-header">
                    <Heading level={2}>Active Notes</Heading>
                    <button onClick={() => console.log('[ChatSidebar] add note')} title="Add note">
                        <MdFillAdd size={18} />
                    </button>
                </header>
                <div class="chat-sidebar-section-body">
                    <NoteList
                        notes={chatNotes()}
                        onNoteClick={(note) => console.log('[ChatSidebar] view note', note)}
                        actions={[
                            {
                                label: 'View',
                                callback: (note) => console.log('[ChatSidebar] view note', note),
                            },
                            {
                                label: 'Remove',
                                danger: true,
                                callback: (note) => console.log('[ChatSidebar] remove note', note),
                            },
                        ]}
                    />
                </div>
            </section>
        </div>
    )
}
