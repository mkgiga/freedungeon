import { nanoid } from 'nanoid'
import { useModal } from './Modal'
import { ActorEditor } from './ActorEditor'
import { NoteEditor } from './NoteEditor'
import type { Actor, Note } from '@shared/types'

/**
 * Opens an actor or a note in a modal.
 *
 * For the Scenario editor, which can't navigate away without discarding its
 * draft, and the chat sidebar, where reading a note shouldn't cost you the
 * conversation. Shared so the two can't drift.
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
        createActor: (opts: { homeChatId?: string | null; onCreated?: (actor: Actor) => void }) => modal.open({
            title: 'New character',
            fullscreen: true,
            content: () => (
                <ActorEditor
                    customId={nanoid(12)}
                    edit
                    homeChatId={opts.homeChatId}
                    footer={(ctx) => footer(ctx.save)}
                    onSaved={(actor) => opts.onCreated?.(actor)}
                />
            ),
        }),

        createNote: (opts: { homeChatId?: string | null; onCreated?: (id: string) => void }) => modal.open({
            title: 'New note',
            fullscreen: true,
            content: () => (
                <NoteEditor
                    noteId={nanoid()}
                    edit
                    homeChatId={opts.homeChatId}
                    footer={(ctx) => footer(ctx.save)}
                    onSaved={(id) => opts.onCreated?.(id)}
                />
            ),
        }),

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
