import { For, Show, createEffect, createMemo, createSignal, onMount, untrack } from 'solid-js'
import { createStore } from 'solid-js/store'
import { MdFillAdd, MdFillCheck, MdFillLibrary_add, MdFillNote_add, MdFillPerson_add, MdFillSmart_toy, MdFillUpload } from 'solid-icons/md'
import { state } from '../../state'
import { trpc } from '../../trpc'
import { TopBar } from '../TopBar'
import { Heading } from '../typography/Heading'
import { Text } from '../typography/Text'
import { Em } from '../typography/Em'
import { ImageIcon } from '../ImageIcon'
import { ActorCardGrid } from './ActorCardGrid'
import { useResourceEditors } from '../ResourceEditors'
import { ChoiceDialog } from '../ChoiceDialog'
import { NoteList } from '../notes'
import { ActorPicker, NotePicker } from '../chat/AssetPicker'
import { ImagePicker } from '../chat/ImagePicker'
import { useModal } from '../Modal'
import { generateName } from '../../utils/names'
import { createImageDrop, pickImage } from '../../utils/imageUpload'
import type { Actor, Chat, ImageAsset, Note } from '@shared/types'
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
    const editors = useResourceEditors()

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

    /**
     * Fold the collaborator's changes into the draft while it's open.
     *
     * The agent writes cast and note membership straight to server state, but
     * this editor holds an uncommitted draft, so nothing showed up until you
     * reopened the screen. Overwriting from the server would fix that and throw
     * away whatever you'd toggled meanwhile, so apply the server's *delta*
     * instead — the agent's additions land, your pending edits survive.
     *
     * Only membership is synced. The agent has no tool that touches the title,
     * description, or images, so those stay yours until Save.
     */
    const syncMembership = (key: 'actors' | 'notes', readServer: (c: Chat) => string[]) => {
        let last = new Set(untrack(() => { const c = serverChat(); return c ? readServer(c) : [] }))
        createEffect(() => {
            const c = serverChat()
            if (!c) return
            const next = new Set(readServer(c))
            untrack(() => {
                const merged = new Set(draft[key])
                for (const id of next) if (!last.has(id)) merged.add(id)
                for (const id of last) if (!next.has(id)) merged.delete(id)
                last = next
                setDraft(key, merged)
            })
        })
    }

    syncMembership('actors', (c) => c.assets.actors)
    syncMembership('notes', (c) => Object.keys(c.assets.notes))

    /**
     * Which resources changed while you were watching.
     *
     * The collaborator edits server state directly, so without a tell the grid
     * just silently differs — you can't see whether it created a character,
     * renamed one, or did nothing. Keyed on `updatedAt`, so it catches edits to
     * an existing card, not only arrivals.
     *
     * The order survives the flash: the highlight fades after a couple of
     * seconds, but a card that jumped to the front stays there for the session.
     * Sliding back a moment later would be its own distraction.
     */
    const FLASH_MS = 2200
    const [touchedAt, setTouchedAt] = createSignal<Record<string, number>>({})
    const [flashing, setFlashing] = createSignal<Record<string, true>>({})

    const flash = (id: string) => {
        setFlashing(f => ({ ...f, [id]: true }))
        setTimeout(() => setFlashing(({ [id]: _gone, ...rest }) => rest), FLASH_MS)
    }

    {
        const lastSeen = new Map<string, number>()
        // The first pass only records: on open everything is "new", and lighting
        // the whole grid up says nothing.
        let primed = false
        createEffect(() => {
            const resources = [
                ...[...draft.actors].map(id => state.assets.actors[id]),
                ...[...draft.notes].map(id => state.assets.notes[id]),
            ].filter(Boolean) as { id: string; updatedAt: number }[]
            // Track updatedAt reactively, decide untracked — the writes below
            // would otherwise re-trigger this effect.
            const stamps = resources.map(r => [r.id, r.updatedAt] as const)

            untrack(() => {
                const now = Date.now()
                const touched: string[] = []
                for (const [id, updatedAt] of stamps) {
                    const prev = lastSeen.get(id)
                    lastSeen.set(id, updatedAt)
                    if (primed && (prev === undefined || updatedAt > prev)) touched.push(id)
                }
                if (touched.length) {
                    setTouchedAt(t => ({ ...t, ...Object.fromEntries(touched.map(id => [id, now])) }))
                    touched.forEach(flash)
                }
                primed = true
            })
        })
    }

    const isFlashing = (id: string) => Boolean(flashing()[id])

    /** Most recently changed first; everything else keeps its existing order. */
    const recentFirst = <T extends { id: string }>(items: T[]): T[] => {
        const at = touchedAt()
        if (Object.keys(at).length === 0) return items
        return [...items].sort((a, b) => (at[b.id] ?? 0) - (at[a.id] ?? 0))
    }

    const actorItems = createMemo<Actor[]>(() =>
        recentFirst(visible([...draft.actors]
            .map(id => state.assets.actors[id])
            .filter((a): a is Actor => Boolean(a))))
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
    const editActor = editors.openActor
    const editNote = editors.openNote

    const toggleNote = (id: string) => {
        const next = new Set(draft.notes)
        if (next.has(id)) next.delete(id)
        else next.add(id)
        setDraft('notes', next)
    }

    const openLibraryPicker = () => {
        modal.open({
            title: 'Import from library',
            content: () => (
                <ActorPicker
                    selected={() => draft.actors}
                    onToggle={(a) => toggleActor(a.id)}
                />
            ),
        })
    }

    /**
     * "Add characters" forked in two.
     *
     * It used to go straight to a picker over the global library, which assumes
     * you have one — a tester with an empty library hit a list of nothing and
     * had no idea a library was even the thing being shown. Writing a character
     * is now the first option, and the second names where the other ones come
     * from.
     */
    const openActorPicker = () => {
        modal.open({
            title: 'Add characters',
            content: () => (
                <ChoiceDialog
                    choices={[
                        {
                            label: 'Create new character',
                            hint: 'Write one for this scenario.',
                            icon: <MdFillPerson_add size={24} />,
                            onClick: () => {
                                modal.close()
                                editors.createActor({
                                    // Authored into this scenario, so it stays
                                    // out of the global library — same as the
                                    // collaborator's create_character. A cast
                                    // written for one story shouldn't turn up
                                    // in every other one's picker.
                                    homeChatId: props.id,
                                    onCreated: (actor) => toggleActor(actor.id),
                                })
                            },
                        },
                        {
                            label: 'Import from library',
                            hint: 'Reuse a character you already made.',
                            icon: <MdFillLibrary_add size={24} />,
                            onClick: () => { modal.close(); openLibraryPicker() },
                        },
                    ]}
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

    const openNoteLibraryPicker = () => {
        modal.open({
            title: 'Import from library',
            content: () => (
                <NotePicker
                    selected={() => draft.notes}
                    onToggle={(n) => toggleNote(n.id)}
                />
            ),
        })
    }

    /** Same fork as characters — writing one has to be reachable from here. */
    const openNotePicker = () => {
        modal.open({
            title: 'Add notes',
            content: () => (
                <ChoiceDialog
                    choices={[
                        {
                            label: 'Create new note',
                            hint: 'Write one for this scenario.',
                            icon: <MdFillNote_add size={24} />,
                            onClick: () => {
                                modal.close()
                                editors.createNote({
                                    homeChatId: props.id,
                                    onCreated: (id) => toggleNote(id),
                                })
                            },
                        },
                        {
                            label: 'Import from library',
                            hint: 'Reuse a note you already wrote.',
                            icon: <MdFillLibrary_add size={24} />,
                            onClick: () => { modal.close(); openNoteLibraryPicker() },
                        },
                    ]}
                />
            ),
        })
    }

    const pickAndUpload = async (onUploaded: (url: string) => void) => {
        const url = await pickImage()
        if (url) onUploaded(url)
    }

    const bannerDrop = createImageDrop((url) => setDraft('bannerUrl', url))
    const avatarDrop = createImageDrop((url) => setDraft('avatarUrl', url))

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
                    classList={{ 'is-empty': !draft.bannerUrl, 'is-drop-target': bannerDrop.over() }}
                    onClick={() => pickAndUpload((url) => setDraft('bannerUrl', url))}
                    title="Click to change banner"
                    {...bannerDrop.handlers}
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
                        classList={{ 'is-drop-target': avatarDrop.over() }}
                        onClick={(e) => {
                            e.stopPropagation()
                            pickAndUpload((url) => setDraft('avatarUrl', url))
                        }}
                        title="Click to change avatar"
                        {...avatarDrop.handlers}
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
                                isFlashing={(a) => isFlashing(a.id)}
                                addNew={{ label: 'Add characters', onClick: openActorPicker }}
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
                                isFlashing={(n) => isFlashing(n.id)}
                                priority={(n) => touchedAt()[n.id] ?? 0}
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

