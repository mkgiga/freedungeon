import { createFileRoute, useNavigate } from '@tanstack/solid-router'
import { state } from '../../../state'
import { trpc } from '../../../trpc'
import { TopBar } from '../../../components/TopBar'
import { Show, Suspense } from 'solid-js'
import { MdFillCheck } from 'solid-icons/md'
import { createStore } from 'solid-js/store'
import { useModal } from '../../../components/Modal'
import { Heading } from '../../../components/typography/Heading'
import { Text } from '../../../components/typography/Text'
import { TextEditor } from '../../../components/TextEditor'
import { Loader } from '../../../components/Loader'
import { EmojiPicker } from 'solid-emoji-picker'

export const Route = createFileRoute('/notes/$id/')({
  component: RouteComponent,
  validateSearch: (search: Record<string, unknown>) => ({
    edit: search.edit === true || search.edit === 'true',
  }),
})

function RouteComponent() {
  const params = Route.useParams()
  const search = Route.useSearch()
  const routeId = () => params().id
  const edit = () => search().edit
  const navigate = useNavigate()
  const modal = useModal()

  const serverNote = () => state.assets.notes[routeId()]
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
    })
    if (edit()) {
      navigate({ to: '/notes/$id', params: { id: result.id }, search: { edit: false }, replace: true })
    }
  }

  const openEmojiPicker = () => {
    modal.open({
      title: 'Pick an icon',
      content: () => (
        <div class="flex flex-col gap-2">
          <Show when={draft.emoji}>
            <button
              class="self-end text-sm opacity-70 hover:opacity-100 px-2 py-1 rounded"
              onClick={() => { setDraft('emoji', undefined); modal.close() }}
            >
              Clear
            </button>
          </Show>
          <Suspense fallback={<div class="flex justify-center p-8"><Loader size={24} /></div>}>
            <EmojiPicker onEmojiClick={(item) => {
              setDraft('emoji', item.emoji)
              modal.close()
            }} />
          </Suspense>
        </div>
      ),
    })
  }

  return (
    <div class="flex flex-col h-full overflow-hidden">
      <TopBar
        backButton
        title={draft.title}
        slots={{
          right: edit() ? (
            <button onClick={save}>
              <MdFillCheck size={28} />
            </button>
          ) : undefined
        }}
      />

      <div class="flex-1 overflow-y-auto p-4">
        {/* Emoji + Title */}
        <section class="mb-4 flex items-start gap-3">
          <button
            type="button"
            class="note-emoji-trigger"
            disabled={!edit()}
            onClick={openEmojiPicker}
            aria-label="Pick icon"
          >
            <Show when={draft.emoji} fallback={<span class="opacity-40">📝</span>}>
              <span>{draft.emoji}</span>
            </Show>
          </button>
          <div class="min-w-0">
            <Show when={edit()} fallback={<Heading level={1}>{draft.title}</Heading>}>
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

        {/* Type */}
        <section class="mb-4">
          <Heading level={4} class="mb-1">Type</Heading>
          <Show when={edit()} fallback={
            <Text class="opacity-70">{draft.type || 'No type set'}</Text>
          }>
            <input
              type="text"
              value={draft.type}
              placeholder="e.g. system, lore, character, worldbuilding"
              class="w-full bg-transparent rounded p-1 outline-none focus:ring focus:ring-(--primary)"
              onInput={(e) => setDraft('type', e.currentTarget.value)}
            />
          </Show>
        </section>

        {/* Content */}
        <section class="mb-6">
          <TextEditor
            title="Content"
            description="The content of this note. This can be injected into the system prompt."
            value={() => draft.content}
            onInput={(v) => setDraft('content', v)}
            readOnly={!edit()}
          />
        </section>
      </div>
    </div>
  )
}
