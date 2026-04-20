import { createFileRoute, useNavigate } from '@tanstack/solid-router'
import { For, Show, createMemo, onMount } from 'solid-js'
import { createStore } from 'solid-js/store'
import { MdFillAdd, MdFillCheck } from 'solid-icons/md'
import { state } from '../../../state'
import { trpc } from '../../../trpc'
import { TopBar } from '../../../components/TopBar'
import { Heading } from '../../../components/typography/Heading'
import { Text } from '../../../components/typography/Text'
import { ImageIcon } from '../../../components/ImageIcon'
import type { Chat } from '@shared/types'

export const Route = createFileRoute('/chat/$id/')({
    component: ChatDetailRoute,
})

function ChatDetailRoute() {
    const params = Route.useParams()
    const navigate = useNavigate()

    const chat = (): Chat | undefined => state.assets.chats[params().id]

    const [draft, setDraft] = createStore<{
        title: string
        avatarUrl: string
        bannerUrl: string
        description: string
        actors: Set<string>
        notes: Set<string>
    }>({
        title: '',
        avatarUrl: '',
        bannerUrl: '',
        description: '',
        actors: new Set(),
        notes: new Set(),
    })

    // Populate draft once the chat is present in state.
    onMount(() => {
        const c = chat()
        if (!c) return
        setDraft({
            title: c.title,
            avatarUrl: c.avatarUrl ?? '',
            bannerUrl: c.bannerUrl ?? '',
            description: c.description ?? '',
            actors: new Set(c.assets.actors),
            notes: new Set(c.assets.notes),
        })
    })

    const allActors = createMemo(() =>
        Object.values(state.assets.actors).sort((a, b) => a.name.localeCompare(b.name))
    )
    const allNotes = createMemo(() =>
        Object.values(state.assets.notes).sort((a, b) => a.title.localeCompare(b.title))
    )

    const toggleActor = (id: string) => {
        const next = new Set(draft.actors)
        if (next.has(id)) next.delete(id)
        else next.add(id)
        setDraft('actors', next)
    }

    const toggleNote = (id: string) => {
        const next = new Set(draft.notes)
        if (next.has(id)) next.delete(id)
        else next.add(id)
        setDraft('notes', next)
    }

    const cancel = () => navigate({ to: '/chat' })

    const save = async () => {
        await trpc.chat.update.mutate({
            id: params().id,
            patch: {
                title: draft.title,
                avatarUrl: draft.avatarUrl,
                bannerUrl: draft.bannerUrl,
                description: draft.description,
                actors: [...draft.actors],
                notes: [...draft.notes],
            },
        })
        navigate({ to: '/chat' })
    }

    const createActor = () => navigate({ to: '/actors' })
    const createNote = () => navigate({ to: '/notes' })

    return (
        <Show when={chat()} fallback={<div class="p-4 opacity-60">Chat not found.</div>}>
            <div class="flex flex-col h-full overflow-hidden">
                <TopBar
                    title={draft.title || 'Untitled'}
                    backButton={cancel}
                    slots={{
                        right: (
                            <button onClick={save} title="Save">
                                <MdFillCheck size={28} />
                            </button>
                        ),
                    }}
                />

                <div class="flex-1 overflow-y-auto">
                    {/* Banner + avatar */}
                    <div class="chat-detail-banner">
                        <Show when={draft.bannerUrl}>
                            <img src={draft.bannerUrl} alt="" class="chat-detail-banner-img" />
                        </Show>
                        <div class="chat-detail-avatar">
                            <ImageIcon url={draft.avatarUrl || undefined} size={96} />
                        </div>
                    </div>

                    <div class="chat-detail-body">
                        {/* Title */}
                        <section class="mb-4">
                            <Heading level={4} class="mb-1">Title</Heading>
                            <input
                                type="text"
                                value={draft.title}
                                class="chat-detail-input"
                                onInput={(e) => setDraft('title', e.currentTarget.value)}
                            />
                        </section>

                        {/* Media URLs */}
                        <section class="mb-4 grid grid-cols-2 gap-3">
                            <label class="flex flex-col gap-1">
                                <Text size="sm" class="opacity-60">Avatar URL</Text>
                                <input
                                    type="text"
                                    value={draft.avatarUrl}
                                    class="chat-detail-input"
                                    placeholder="https://…"
                                    onInput={(e) => setDraft('avatarUrl', e.currentTarget.value)}
                                />
                            </label>
                            <label class="flex flex-col gap-1">
                                <Text size="sm" class="opacity-60">Banner URL</Text>
                                <input
                                    type="text"
                                    value={draft.bannerUrl}
                                    class="chat-detail-input"
                                    placeholder="https://…"
                                    onInput={(e) => setDraft('bannerUrl', e.currentTarget.value)}
                                />
                            </label>
                        </section>

                        {/* Description */}
                        <section class="mb-4">
                            <Heading level={4} class="mb-1">Description</Heading>
                            <textarea
                                value={draft.description}
                                class="chat-detail-input chat-detail-textarea"
                                rows={4}
                                onInput={(e) => setDraft('description', e.currentTarget.value)}
                            />
                        </section>

                        {/* Actors + Notes */}
                        <section class="grid grid-cols-2 gap-6 mb-4">
                            <div>
                                <div class="chat-detail-section-header">
                                    <Heading level={2}>Actors</Heading>
                                    <button class="chat-detail-plus" onClick={createActor} title="New actor">
                                        <MdFillAdd size={20} />
                                    </button>
                                </div>
                                <div class="chat-detail-checklist">
                                    <For each={allActors()} fallback={<Text size="sm" class="opacity-50">No actors yet</Text>}>
                                        {(actor) => (
                                            <label class="chat-detail-checklist-row">
                                                <input
                                                    type="checkbox"
                                                    checked={draft.actors.has(actor.id)}
                                                    onChange={() => toggleActor(actor.id)}
                                                />
                                                <Text size="sm">{actor.name}</Text>
                                            </label>
                                        )}
                                    </For>
                                </div>
                            </div>

                            <div>
                                <div class="chat-detail-section-header">
                                    <Heading level={2}>Notes</Heading>
                                    <button class="chat-detail-plus" onClick={createNote} title="New note">
                                        <MdFillAdd size={20} />
                                    </button>
                                </div>
                                <div class="chat-detail-checklist">
                                    <For each={allNotes()} fallback={<Text size="sm" class="opacity-50">No notes yet</Text>}>
                                        {(note) => (
                                            <label class="chat-detail-checklist-row">
                                                <input
                                                    type="checkbox"
                                                    checked={draft.notes.has(note.id)}
                                                    onChange={() => toggleNote(note.id)}
                                                />
                                                <Show when={note.emoji}>
                                                    <span class="chat-detail-note-emoji">{note.emoji}</span>
                                                </Show>
                                                <Text size="sm">{note.title}</Text>
                                            </label>
                                        )}
                                    </For>
                                </div>
                            </div>
                        </section>

                        {/* Bottom actions — duplicated exits */}
                        <div class="chat-detail-footer">
                            <button class="modal-btn modal-btn-cancel" onClick={cancel}>Cancel</button>
                            <button class="modal-btn modal-btn-confirm" onClick={save}>Save</button>
                        </div>
                    </div>
                </div>
            </div>
        </Show>
    )
}
