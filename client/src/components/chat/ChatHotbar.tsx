import { For, Show, createMemo, type JSXElement } from 'solid-js'
import { state } from '../../state'
import { trpc } from '../../trpc'

type HotbarEntry = {
    noteId: string
    emoji: string
    title: string
    enabled: boolean
}

export function ChatHotbar(): JSXElement {
    const entries = createMemo<HotbarEntry[]>(() => {
        const hotbar = state.currentChat.hotbarNotes
        return Object.entries(hotbar).map(([noteId, v]) => {
            const note = state.assets.notes[noteId]
            return {
                noteId,
                emoji: note?.emoji ?? '📝',
                title: note?.title ?? noteId,
                enabled: v.enabled,
            }
        })
    })

    const toggle = (noteId: string) => {
        trpc.chat.toggleHotbarNote.mutate({ noteId })
    }

    return (
        <Show when={entries().length > 0}>
            <div class="chat-hotbar">
                <For each={entries()}>
                    {(entry) => (
                        <button
                            type="button"
                            class="chat-hotbar-item"
                            classList={{ 'is-enabled': entry.enabled }}
                            title={`${entry.title}${entry.enabled ? ' (on)' : ' (off)'}`}
                            onClick={() => toggle(entry.noteId)}
                        >
                            <span>{entry.emoji}</span>
                        </button>
                    )}
                </For>
            </div>
        </Show>
    )
}
