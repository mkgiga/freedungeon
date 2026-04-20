import { createFileRoute, useNavigate } from '@tanstack/solid-router'
import { Show, createMemo, onMount } from 'solid-js'
import { createStore } from 'solid-js/store'
import { MdFillAdd, MdFillCheck } from 'solid-icons/md'
import { state } from '../../../state'
import { trpc } from '../../../trpc'
import { TopBar } from '../../../components/TopBar'
import { Heading } from '../../../components/typography/Heading'
import { Text } from '../../../components/typography/Text'
import { ImageIcon } from '../../../components/ImageIcon'
import { ActorList } from '../../../components/actors'
import { NoteList } from '../../../components/notes'
import { ActorPicker, NotePicker } from '../../../components/chat/AssetPicker'
import { useModal } from '../../../components/Modal'
import { generateName } from '../../../utils/names'
import type { Actor, Note } from '@shared/types'

export const Route = createFileRoute('/chat/$id/')({
    component: ChatDetailRoute,
    validateSearch: (search: Record<string, unknown>) => ({
        new: search.new === true || search.new === 'true',
        isTemplate: search.isTemplate === true || search.isTemplate === 'true',
    }),
})

function ChatDetailRoute() {
    const params = Route.useParams()
    const search = Route.useSearch()
    const navigate = useNavigate()
    const modal = useModal()

    const serverChat = () => state.assets.chats[params().id]
    const isNew = () => !serverChat()

    // Default title for new templates: "New Template", "New Template 2", ...
    // Computed once at seed time so it doesn't flip around as the user types.
    const defaultTitle = () => {
        if (!isNew()) return ''
        const existingTitles = Object.values(state.assets.chats)
            .filter(c => c.isTemplate === search().isTemplate)
            .map(c => c.title)
        return generateName({
            input: search().isTemplate ? 'Template' : 'Chat',
            prefix: 'New',
            existingNames: existingTitles,
        })
    }

    const [draft, setDraft] = createStore<{
        title: string
        avatarUrl: string
        bannerUrl: string
        description: string
        actors: Set<string>
        notes: Set<string>
        isTemplate: boolean
    }>({
        title: isNew() ? defaultTitle() : serverChat()?.title ?? '',
        avatarUrl: serverChat()?.avatarUrl ?? '',
        bannerUrl: serverChat()?.bannerUrl ?? '',
        description: serverChat()?.description ?? '',
        actors: new Set(serverChat()?.assets.actors ?? []),
        notes: new Set(serverChat()?.assets.notes ?? []),
        isTemplate: serverChat()?.isTemplate ?? search().isTemplate,
    })

    // When the chat arrives from the server after initial mount (late state
    // sync), backfill the draft. Skipped for new drafts so we don't stomp them.
    onMount(() => {
        if (isNew()) return
        const c = serverChat()
        if (!c) return
        setDraft({
            title: c.title,
            avatarUrl: c.avatarUrl ?? '',
            bannerUrl: c.bannerUrl ?? '',
            description: c.description ?? '',
            actors: new Set(c.assets.actors),
            notes: new Set(c.assets.notes),
            isTemplate: c.isTemplate,
        })
    })

    const actorItems = createMemo<Actor[]>(() =>
        [...draft.actors]
            .map(id => state.assets.actors[id])
            .filter((a): a is Actor => Boolean(a))
    )
    const noteItems = createMemo<Note[]>(() =>
        [...draft.notes]
            .map(id => state.assets.notes[id])
            .filter((n): n is Note => Boolean(n))
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

    const openActorPicker = () => {
        modal.open({
            title: 'Add actors',
            content: () => (
                <ActorPicker
                    selected={() => draft.actors}
                    onToggle={(a) => toggleActor(a.id)}
                />
            ),
        })
    }

    const openNotePicker = () => {
        modal.open({
            title: 'Add notes',
            content: () => (
                <NotePicker
                    selected={() => draft.notes}
                    onToggle={(n) => toggleNote(n.id)}
                />
            ),
        })
    }

    const cancel = () => navigate({ to: '/chat' })

    const save = async () => {
        if (isNew()) {
            await trpc.chat.create.mutate({
                id: params().id,
                title: draft.title,
                isTemplate: draft.isTemplate,
                avatarUrl: draft.avatarUrl,
                bannerUrl: draft.bannerUrl,
                description: draft.description,
                actors: [...draft.actors],
                notes: [...draft.notes],
            })
        } else {
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
        }
        navigate({ to: '/chat' })
    }

    return (
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

                    {/* Actors + Notes — mirror the conversation drawer sidebar:
                        only show this chat's refs, with a + that opens the same
                        picker modal and a Remove dropdown action per row. */}
                    <section class="grid grid-cols-2 gap-6 mb-4">
                        <div>
                            <div class="chat-detail-section-header">
                                <Heading level={2}>Actors</Heading>
                                <button class="chat-detail-plus" onClick={openActorPicker} title="Add actor">
                                    <MdFillAdd size={20} />
                                </button>
                            </div>
                            <ActorList
                                actors={actorItems()}
                                hideHeader
                                actions={[
                                    {
                                        label: 'Remove',
                                        danger: true,
                                        callback: (a) => toggleActor(a.id),
                                    },
                                ]}
                            />
                        </div>

                        <div>
                            <div class="chat-detail-section-header">
                                <Heading level={2}>Notes</Heading>
                                <button class="chat-detail-plus" onClick={openNotePicker} title="Add note">
                                    <MdFillAdd size={20} />
                                </button>
                            </div>
                            <NoteList
                                notes={noteItems()}
                                showType={false}
                                hideHeader
                                actions={[
                                    {
                                        label: 'Remove',
                                        danger: true,
                                        callback: (n) => toggleNote(n.id),
                                    },
                                ]}
                            />
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
    )
}

