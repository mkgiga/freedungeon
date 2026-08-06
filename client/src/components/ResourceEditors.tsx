import { useModal } from './Modal'
import { ActorEditor } from './ActorEditor'
import { NoteEditor } from './NoteEditor'
import type { Actor, Note } from '@shared/types'

/**
 * Opens an actor or a note in a modal.
 *
 * Used from the Scenario editor, which can't navigate away without discarding
 * its uncommitted draft, and from the chat sidebar, where inspecting a note
 * shouldn't cost you the conversation. Shared so the two can't drift — the
 * asset pickers were duplicated the same way and ended up as a picker on one
 * screen and a <select> on another.
 */
export function useResourceEditors() {
    const modal = useModal()

    const footer = (save: () => Promise<void>) => (
        <div class="editor-modal-footer">
            <button class="modal-btn modal-btn-cancel" onClick={() => modal.close()}>Cancel</button>
            <button
                class="modal-btn modal-btn-confirm"
                onClick={async () => { await save(); modal.close() }}
            >
                Save
            </button>
        </div>
    )

    return {
        openActor: (actor: Actor) => modal.open({
            title: `Edit ${actor.name}`,
            fullscreen: true,
            content: () => (
                <ActorEditor customId={actor.customId} edit footer={(ctx) => footer(ctx.save)} />
            ),
        }),

        openNote: (note: Note) => modal.open({
            title: `Edit ${note.title}`,
            fullscreen: true,
            content: () => (
                <NoteEditor noteId={note.id} edit footer={(ctx) => footer(ctx.save)} />
            ),
        }),
    }
}
