import { Show, Suspense, createSignal, type JSXElement } from 'solid-js'
import { createStore } from 'solid-js/store'
import { EmojiPicker } from 'solid-emoji-picker'
import emojiKeywords from 'emojilib'

import { state } from '../state'
import { trpc } from '../trpc'
import { useModal } from './Modal'
import { Heading } from './typography/Heading'
import { Text } from './typography/Text'
import { TextEditor } from './TextEditor'
import { Loader } from './Loader'

const stripVS = (s: string) => s.replace(/\uFE0F/g, '')
const keywordsByEmoji: Record<string, string[]> = (() => {
    const out: Record<string, string[]> = {}
    for (const [k, v] of Object.entries(emojiKeywords as Record<string, string[]>)) {
        out[stripVS(k)] = v
    }
    return out
})()

export type NoteEditorChrome = {
    title: string
    editing: boolean
    save: () => Promise<void>
}

export function NoteEditor(props: {
    noteId: string
    edit: boolean
    chrome?: (ctx: NoteEditorChrome) => JSXElement
    footer?: (ctx: NoteEditorChrome) => JSXElement
    homeChatId?: string | null
    onSaved?: (id: string) => void
}) {
    const modal = useModal()

    const serverNote = () => state.assets.notes[props.noteId]
    const isNew = () => !serverNote()

    const [draft, setDraft] = createStore<{
        id: string
        title: string
        type: string
        content: string
        emoji?: string
        createdAt: number
        updatedAt: number
    }>(
        serverNote() ?? {
            id: '',
            title: 'New Note',
            type: '',
            content: '',
            emoji: undefined,
            createdAt: Date.now(),
            updatedAt: Date.now(),
        }
    )

    const save = async () => {
        const result = await trpc.notes.upsert.mutate({
            id: isNew() ? undefined : draft.id,
            title: draft.title,
            type: draft.type,
            content: draft.content,
            emoji: draft.emoji,
            ...(props.homeChatId !== undefined ? { homeChatId: props.homeChatId } : {}),
        })
        props.onSaved?.(result.id)
    }

    const openEmojiPicker = () => {
        const [query, setQuery] = createSignal('')
        const matches = (emoji: { name: string; slug: string; emoji: string }) => {
            const q = query().trim().toLowerCase()
            if (!q) return true
            const terms = q.split(/\s+/)
            const keywords = keywordsByEmoji[stripVS(emoji.emoji)] ?? []
            const haystack = `${emoji.name.toLowerCase()} ${emoji.slug} ${keywords.join(' ')}`
            return terms.every(t => haystack.includes(t))
        }
        modal.open({
            title: 'Pick an icon',
            content: () => (
                <div class="flex flex-col gap-2 min-w-[320px]">
                    <div class="flex items-center gap-2">
                        <input
                            type="text"
                            placeholder="Search emoji…"
                            autofocus
                            value={query()}
                            onInput={(e) => setQuery(e.currentTarget.value)}
                            class="flex-1 bg-transparent border border-[color-mix(in_oklch,var(--text),transparent_70%)] rounded px-2 py-1 outline-none focus:ring focus:ring-(--primary)"
                        />
                        <Show when={draft.emoji}>
                            <button
                                class="text-sm opacity-70 hover:opacity-100 px-2 py-1 rounded"
                                onClick={() => { setDraft('emoji', undefined); modal.close() }}
                            >
                                Clear
                            </button>
                        </Show>
                    </div>
                    <Suspense fallback={<div class="flex justify-center p-8"><Loader size={24} /></div>}>
                        <EmojiPicker
                            filter={matches}
                            onEmojiClick={(item) => {
                                setDraft('emoji', item.emoji)
                                modal.close()
                            }}
                        />
                    </Suspense>
                </div>
            ),
        })
    }

    return (
        <div class="flex flex-col h-full overflow-hidden">
            {props.chrome?.({ get title() { return draft.title }, editing: props.edit, save })}

            <div class="editor-body flex-1 overflow-y-auto p-4">
                <section class="mb-4 flex items-start gap-3">
                    <button
                        type="button"
                        class="note-emoji-trigger"
                        disabled={!props.edit}
                        onClick={openEmojiPicker}
                        aria-label="Pick icon"
                    >
                        <Show when={draft.emoji} fallback={<span class="opacity-40">📝</span>}>
                            <span>{draft.emoji}</span>
                        </Show>
                    </button>
                    <div class="min-w-0">
                        <Show when={props.edit} fallback={<Heading level={1}>{draft.title}</Heading>}>
                            <Heading level={4} class="mb-1">Title</Heading>
                            <input
                                type="text"
                                value={draft.title}
                                class="w-full text-xl font-bold bg-transparent rounded p-1 outline-none focus:ring focus:ring-(--primary)"
                                onInput={(e) => setDraft('title', e.currentTarget.value)}
                            />
                        </Show>
                    </div>
                </section>

                <section class="mb-4">
                    <Heading level={4} class="mb-1">Type</Heading>
                    <Show when={props.edit} fallback={
                        <Text class="opacity-70">{draft.type || 'No type set'}</Text>
                    }>
                        <input
                            type="text"
                            value={draft.type}
                            placeholder="e.g. lore, rules, character"
                            class="w-full bg-transparent rounded p-1 outline-none focus:ring focus:ring-(--primary)"
                            onInput={(e) => setDraft('type', e.currentTarget.value)}
                        />
                    </Show>
                </section>

                <section class="editor-fill mb-6">
                    <TextEditor
                        title="Content"
                        description="Extra context the dungeon master always sees."
                        value={() => draft.content}
                        onInput={(v) => setDraft('content', v)}
                        readOnly={!props.edit}
                    />
                </section>
            </div>

            {props.footer?.({ get title() { return draft.title }, editing: props.edit, save })}
        </div>
    )
}
