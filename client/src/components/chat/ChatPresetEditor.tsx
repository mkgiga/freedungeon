import { For, Show, createMemo, createSignal, onMount } from 'solid-js'
import { createStore } from 'solid-js/store'
import { MdFillAdd, MdFillCheck, MdFillSmart_toy, MdFillUpload } from 'solid-icons/md'
import { state } from '../../state'
import { trpc } from '../../trpc'
import { TopBar } from '../TopBar'
import { Heading } from '../typography/Heading'
import { Text } from '../typography/Text'
import { Em } from '../typography/Em'
import { ImageIcon } from '../ImageIcon'
import { ActorCardGrid } from './ActorCardGrid'
import { ActorEditor } from '../ActorEditor'
import { NoteEditor } from '../NoteEditor'
import { NoteList } from '../notes'
import { ActorPicker, NotePicker } from '../chat/AssetPicker'
import { ImagePicker } from '../chat/ImagePicker'
import { useModal } from '../Modal'
import { generateName } from '../../utils/names'
import type { Actor, ImageAsset, Note } from '@shared/types'
import { viewport } from '../../viewport'
import { ScenarioCollaborator } from '../scenario/ScenarioCollaborator'
import { visible } from '@shared/visibility'

/**
 * Editor for a chat or a Scenario — they are the same record, distinguished by
 * `isTemplate`. Shared by /chat/$id and /scenarios/$id so the two screens can't
 * drift; the route supplies the id, the flag, and where "done" goes.
 */
export function ChatPresetEditor(props: {
    id: string
    isTemplate: boolean
    onDone: () => void
    /**
     * Scenario-only. On a wide screen the collaborator docks beside the editor;
     * on a phone there's no room, so this opens it as its own screen instead.
     */
    onOpenCollaborator?: () => void
}) {
    const [collabOpen, setCollabOpen] = createSignal(false)
    const wide = () => viewport() === 'wide'
    const modal = useModal()

    const serverChat = () => state.assets.chats[props.id]
    const isNew = () => !serverChat()

    // Default title for new templates: "New Template", "New Template 2", ...
    // Computed once at seed time so it doesn't flip around as the user types.
    const defaultTitle = () => {
        if (!isNew()) return ''
        const existingTitles = Object.values(state.assets.chats)
            .filter(c => c.isTemplate === props.isTemplate)
            .map(c => c.title)
        return generateName({
            input: props.isTemplate ? 'Template' : 'Chat',
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
        images: string[]
        isTemplate: boolean
    }>({
        title: isNew() ? defaultTitle() : serverChat()?.title ?? '',
        avatarUrl: serverChat()?.avatarUrl ?? '',
        bannerUrl: serverChat()?.bannerUrl ?? '',
        description: serverChat()?.description ?? '',
        actors: new Set(serverChat()?.assets.actors ?? []),
        notes: new Set(Object.keys(serverChat()?.assets.notes ?? {})),
        images: [...(serverChat()?.assets.images ?? [])],
        isTemplate: serverChat()?.isTemplate ?? props.isTemplate,
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
            notes: new Set(Object.keys(c.assets.notes)),
            images: [...(c.assets.images ?? [])],
            isTemplate: c.isTemplate,
        })
    })

    const actorItems = createMemo<Actor[]>(() =>
        visible([...draft.actors]
            .map(id => state.assets.actors[id])
            .filter((a): a is Actor => Boolean(a)))
    )
    const noteItems = createMemo<Note[]>(() =>
        visible([...draft.notes]
            .map(id => state.assets.notes[id])
            .filter((n): n is Note => Boolean(n)))
    )

    const toggleActor = (id: string) => {
        const next = new Set(draft.actors)
        if (next.has(id)) next.delete(id)
        else next.add(id)
        setDraft('actors', next)
    }

    // Both open in a modal rather than navigating: this editor's draft is
    // uncommitted until Save, and leaving for /actors/$id or /notes/$id would
    // unmount it and throw that draft away.
    const modalFooter = (save: () => Promise<void>) => (
        <div class="editor-modal-footer">
            <button class="modal-btn modal-btn-cancel" onClick={() => modal.close()}>Cancel</button>
            <button class="modal-btn modal-btn-confirm" onClick={async () => { await save(); modal.close() }}>Save</button>
        </div>
    )

    const editActor = (actor: Actor) => {
        modal.open({
            title: `Edit ${actor.name}`,
            fullscreen: true,
            content: () => (
                <ActorEditor customId={actor.customId} edit footer={(ctx) => modalFooter(ctx.save)} />
            ),
        })
    }

    const editNote = (note: Note) => {
        modal.open({
            title: `Edit ${note.title}`,
            fullscreen: true,
            content: () => (
                <NoteEditor noteId={note.id} edit footer={(ctx) => modalFooter(ctx.save)} />
            ),
        })
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

    const imageItems = createMemo<ImageAsset[]>(() =>
        draft.images
            .map(id => state.assets.images[id])
            .filter((i): i is ImageAsset => Boolean(i))
    )

    const toggleImage = (id: string) => {
        setDraft('images', draft.images.includes(id)
            ? draft.images.filter(i => i !== id)
            : [...draft.images, id])
    }

    const openImagePicker = () => {
        modal.open({
            title: 'Images',
            content: () => (
                <ImagePicker
                    selected={() => draft.images}
                    onToggle={(image) => toggleImage(image.id)}
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

    const pickAndUpload = (onUploaded: (url: string) => void) => {
        const input = document.createElement('input')
        input.type = 'file'
        input.accept = 'image/*'
        input.onchange = async () => {
            const file = input.files?.[0]
            if (!file) return
            const formData = new FormData()
            formData.append('file', file)
            const res = await fetch('/uploads', { method: 'POST', body: formData })
            if (res.ok) {
                const { url } = await res.json()
                onUploaded(url)
            }
        }
        input.click()
    }

    const cancel = () => props.onDone()

    const save = async () => {
        if (isNew()) {
            // Server mints the real id — the route param was only a client-side
            // nanoid for URL uniqueness while drafting.
            await trpc.chat.create.mutate({
                title: draft.title,
                isTemplate: draft.isTemplate,
                avatarUrl: draft.avatarUrl,
                bannerUrl: draft.bannerUrl,
                description: draft.description,
                actors: [...draft.actors],
                notes: [...draft.notes],
                images: [...draft.images],
            })
        } else {
            await trpc.chat.update.mutate({
                id: props.id,
                patch: {
                    title: draft.title,
                    avatarUrl: draft.avatarUrl,
                    bannerUrl: draft.bannerUrl,
                    description: draft.description,
                    actors: [...draft.actors],
                    notes: [...draft.notes],
                    images: [...draft.images],
                },
            })
        }
        props.onDone()
    }

    return (
        <div class="flex flex-col h-full overflow-hidden">
            <TopBar
                title={draft.title || 'Untitled'}
                backButton={cancel}
                slots={{
                    // A fragment, not a wrapper div: `.toolbar-right > button`
                    // styles direct children only, so wrapping these strips
                    // their padding and hover state and jams them together.
                    right: (
                        <>
                            <Show when={props.isTemplate}>
                                <button
                                    onClick={() => wide() ? setCollabOpen(o => !o) : props.onOpenCollaborator?.()}
                                    title="Scenario collaborator"
                                    classList={{ active: collabOpen() }}
                                >
                                    <MdFillSmart_toy size={26} />
                                </button>
                            </Show>
                            <button onClick={save} title="Save">
                                <MdFillCheck size={28} />
                            </button>
                        </>
                    ),
                }}
            />

            <div class="preset-editor-body">
            <div class="flex-1 overflow-y-auto">
                {/* Banner + avatar — click to upload */}
                <div
                    class="chat-detail-banner"
                    classList={{ 'is-empty': !draft.bannerUrl }}
                    onClick={() => pickAndUpload((url) => setDraft('bannerUrl', url))}
                    title="Click to change banner"
                >
                    <Show when={draft.bannerUrl} fallback={
                        <div class="chat-detail-banner-empty">
                            <MdFillUpload size={20} class="opacity-60" />
                            <Text size="sm" class="opacity-60">Click to upload a banner</Text>
                        </div>
                    }>
                        <img src={draft.bannerUrl} alt="" class="chat-detail-banner-img" />
                        <div class="chat-detail-banner-overlay">
                            <MdFillUpload size={18} />
                            <Text size="sm"><Em semibold>Change banner</Em></Text>
                        </div>
                    </Show>
                    <div
                        class="chat-detail-avatar"
                        onClick={(e) => {
                            e.stopPropagation()
                            pickAndUpload((url) => setDraft('avatarUrl', url))
                        }}
                        title="Click to change avatar"
                    >
                        <ImageIcon
                            url={draft.avatarUrl || undefined}
                            size={96}
                            placeholder={
                                <div class="chat-detail-avatar-empty">
                                    <MdFillUpload size={22} class="opacity-60" />
                                </div>
                            }
                        />
                        <Show when={draft.avatarUrl}>
                            <div class="chat-detail-avatar-overlay">
                                <Text size="sm"><Em semibold>Change</Em></Text>
                            </div>
                        </Show>
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
                    <section class="chat-detail-cast mb-4">
                        <div>
                            <div class="chat-detail-section-header">
                                <Heading level={2}>Actors</Heading>
                                <button class="chat-detail-plus" onClick={openActorPicker} title="Add actor">
                                    <MdFillAdd size={20} />
                                </button>
                            </div>
                            <ActorCardGrid
                                actors={actorItems()}
                                onRemove={(a) => toggleActor(a.id)}
                                onActorClick={editActor}
                                emptyLabel="None yet — add with +"
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
                                onNoteClick={editNote}
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

                    {/* Images the agent can bring on screen by key (list_images
                        / show_image). Curated here only — images it generates
                        mid-story are never added to this library. */}
                    <section class="mb-4">
                        <div class="chat-detail-section-header">
                            <Heading level={2}>Images</Heading>
                            <button class="chat-detail-plus" onClick={openImagePicker} title="Add image">
                                <MdFillAdd size={20} />
                            </button>
                        </div>
                        <div class="image-picker-grid">
                            <For each={imageItems()} fallback={<Text size="sm" class="opacity-50">No images attached.</Text>}>
                                {(image) => (
                                    <button
                                        class="image-picker-item"
                                        onClick={() => toggleImage(image.id)}
                                        title="Remove from this chat"
                                    >
                                        <img src={image.url} alt="" />
                                        <Text size="sm" class="truncate w-full">{image.label}</Text>
                                        <Text size="sm" font="mono" class="opacity-50 truncate w-full">{image.key}</Text>
                                    </button>
                                )}
                            </For>
                        </div>
                    </section>

                    {/* Bottom actions — duplicated exits */}
                    <div class="chat-detail-footer">
                        <button class="modal-btn modal-btn-cancel" onClick={cancel}>Cancel</button>
                        <button class="modal-btn modal-btn-confirm" onClick={save}>Save</button>
                    </div>
                </div>
            </div>

            {/* Docked, not overlaid: opening it narrows the editor, the same
                way the actors/notes panel behaves in a chat. Wide only — a
                phone opens the collaborator as its own screen. */}
            <Show when={props.isTemplate && wide()}>
                <aside class="chat-side-panel" classList={{ open: collabOpen() }} aria-hidden={!collabOpen()}>
                    <div class="chat-side-panel-inner">
                        <ScenarioCollaborator scenarioId={props.id} />
                    </div>
                </aside>
            </Show>
            </div>
        </div>
    )
}

