import { createFileRoute, useNavigate } from '@tanstack/solid-router'

import { state } from '../../../state'
import { trpc } from '../../../trpc'
import { TopBar } from '../../../components/TopBar'

import { createSignal, For, Show } from 'solid-js'
import { MdFillMore_horiz, MdFillCheck } from 'solid-icons/md'
import { Dropdown } from '../../../components/Dropdown'
import { Heading } from '../../../components/typography/Heading'
import { Text } from '../../../components/typography/Text'
import { TextEditor } from '../../../components/TextEditor'
import { ImageIcon } from '../../../components/ImageIcon'
import { useMediaViewer } from '../../../components/MediaViewer'
import { MdFillUpload } from 'solid-icons/md'

import { createStore } from 'solid-js/store'
import { useModal } from '../../../components/Modal'

export const Route = createFileRoute('/actors/$id/')({
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
  const mediaViewer = useMediaViewer()

  const serverActor = () => Object.values(state.assets.actors ?? {}).find(a => a.customId === routeId())
  const isNew = () => !serverActor()

  const [draft, setDraft] = createStore(
    serverActor() ?? {
      id: '',
      customId: routeId(),
      name: 'New Actor',
      description: '',
      avatarUrl: '',
      expressions: {} as Record<string, string>,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
  )

  const save = async () => {
    const result = await trpc.actors.upsert.mutate({
      id: isNew() ? undefined : draft.id,
      name: draft.name,
      description: draft.description,
      avatarUrl: draft.avatarUrl,
      customId: draft.customId,
      expressions: draft.expressions as Record<string, string>,
    })
    if (edit()) {
      navigate({ to: '/actors/$id', params: { id: result.customId }, search: { edit: false }, replace: true })
    }
  }

  const initials = () => draft.name?.charAt(0)?.toUpperCase() ?? '?'

  const addExpression = () => {
    modal.open({
      title: 'Add Expression',
      content: () => {
        const [name, setName] = createSignal('')
        const [preview, setPreview] = createSignal('')
        let uploadedUrl = ''

        const handleUpload = async (file: File) => {
          setPreview(URL.createObjectURL(file))
          const formData = new FormData()
          formData.append('file', file)
          const res = await fetch('http://localhost:8078/uploads', {
            method: 'POST',
            body: formData,
          })
          if (res.ok) {
            const { url } = await res.json()
            uploadedUrl = url
          }
        }

        return (
          <div class="flex flex-col gap-3">
            <label class="flex flex-col gap-1">
              <span class="text-sm opacity-70">Name</span>
              <input type="text" placeholder="e.g. happy, angry, neutral" class="p-2 rounded bg-(--bg) border border-(--primary)" onInput={(e) => setName(e.currentTarget.value)} />
            </label>
            <label class="flex flex-col gap-1">
              <span class="text-sm opacity-70">Image</span>
              <Show when={preview()} fallback={
                <div class="flex items-center justify-center w-full h-24 rounded border border-dashed border-(--primary) cursor-pointer opacity-50 hover:opacity-100 transition-opacity">
                  <span class="text-sm">Click to upload</span>
                </div>
              }>
                <img src={preview()} class="w-24 h-24 rounded object-cover" />
              </Show>
              <input
                type="file"
                accept="image/*"
                class="hidden"
                onChange={(e) => {
                  const file = e.currentTarget.files?.[0]
                  if (file) handleUpload(file)
                }}
              />
            </label>
            <button
              class="mt-2 p-2 rounded bg-(--primary) text-(--bg) font-semibold"
              onClick={() => {
                const n = name().trim()
                if (n && uploadedUrl) {
                  setDraft('expressions', n, uploadedUrl)
                  modal.close()
                }
              }}
            >
              Add
            </button>
          </div>
        )
      },
    })
  }

  return (
    <div class="flex flex-col h-full">
      <TopBar
        backButton
        title={draft.name}
        slots={{
          right: edit() ? (
            <button onClick={save}>
              <MdFillCheck size={28} />
            </button>
          ) : undefined
        }}
      />

      <div class="flex-1 overflow-y-auto p-4">
        {/* Header card — avatar + name + ID */}
        <section class="flex items-start gap-4 mb-6">
          <div
            class="relative block cursor-pointer"
            onClick={() => {
              if (edit()) {
                const input = document.createElement('input')
                input.type = 'file'
                input.accept = 'image/*'
                input.onchange = async () => {
                  const file = input.files?.[0]
                  if (!file) return
                  const formData = new FormData()
                  formData.append('file', file)
                  const res = await fetch('http://localhost:8078/uploads', {
                    method: 'POST',
                    body: formData,
                  })
                  if (res.ok) {
                    const { url } = await res.json()
                    setDraft('avatarUrl', url)
                  }
                }
                input.click()
              } else if (draft.avatarUrl) {
                mediaViewer.open({ url: draft.avatarUrl, title: draft.name })
              }
            }}
          >
            <ImageIcon
              url={draft.avatarUrl}
              size={80}
              placeholder={
                <div class="flex items-center justify-center rounded-lg border-2 border-dashed border-[color-mix(in_oklch,var(--text),transparent_70%)]" style={{ width: '80px', height: '80px' }}>
                  <Show when={edit()} fallback={<Text size="sm" class="opacity-50 text-center">{initials()}</Text>}>
                    <MdFillUpload size={24} class="opacity-40" />
                  </Show>
                </div>
              }
            />
            <Show when={edit() && draft.avatarUrl}>
              <div class="absolute inset-0 flex items-center justify-center bg-black/50 rounded-lg opacity-0 hover:opacity-100 transition-opacity">
                <span class="text-xs font-semibold">Change</span>
              </div>
            </Show>
          </div>
          <div class="flex flex-col gap-1">
            <Show when={edit()} fallback={<Heading level={1}>{draft.name}</Heading>}>
              <input
                type="text"
                value={draft.name}
                class="text-xl font-bold bg-transparent rounded p-1 outline-none focus:ring focus:ring-(--primary)"
                onInput={(e) => setDraft('name', e.currentTarget.value)}
              />
            </Show>
            <Text size="sm" class="opacity-50 flex items-center gap-1">
              ID
              <Show when={edit()} fallback={<Text size="sm" font="mono" class="opacity-70">{draft.customId}</Text>}>
                <input
                  type="text"
                  value={draft.customId}
                  class="font-mono text-sm bg-transparent border-b border-(--primary) outline-none opacity-70 focus:opacity-100"
                  onInput={(e) => setDraft('customId', e.currentTarget.value)}
                />
              </Show>
            </Text>
          </div>
        </section>

        {/* Description */}
        <section class="mb-6">
          <TextEditor
            title="Description"
            description="General description of the character."
            value={() => draft.description}
            onInput={(v) => setDraft('description', v)}
            readOnly={!edit()}
          />
        </section>

        {/* Expressions */}
        <section>
          <Heading level={2} class="mb-1">Expressions</Heading>
          <Show when={Object.keys(draft.expressions ?? {}).length > 0} fallback={
            <Text size="sm" class="opacity-50 mb-3">No expressions added yet.</Text>
          }>
            <table class="w-full text-sm mb-3">
              <thead>
                <tr class="border-b border-[color-mix(in_oklch,var(--text),transparent_85%)]">
                  <th class="text-left py-2">Preview</th>
                  <th class="text-left py-2">Name</th>
                  <Show when={edit()}><th class="text-right py-2">Actions</th></Show>
                </tr>
              </thead>
              <tbody>
                <For each={Object.entries(draft.expressions ?? {})}>
                  {([name, url]) => (
                    <tr class="border-b border-[color-mix(in_oklch,var(--text),transparent_90%)]">
                      <td class="py-2">
                        <img src={url as string} alt={name} class="w-10 h-10 rounded object-cover" />
                      </td>
                      <td class="py-2">{name}</td>
                      <Show when={edit()}>
                        <td class="py-2 text-right">
                          <Dropdown
                            trigger={<MdFillMore_horiz size={20} />}
                            items={[
                              {
                                label: 'Remove',
                                danger: true,
                                onClick: () => {
                                  const { [name]: _, ...rest } = draft.expressions
                                  setDraft('expressions', rest)
                                },
                              },
                            ]}
                          />
                        </td>
                      </Show>
                    </tr>
                  )}
                </For>
              </tbody>
            </table>
          </Show>
          <Show when={edit()}>
            <button
              class="w-full p-3 rounded-lg border border-dashed border-[color-mix(in_oklch,var(--text),transparent_70%)] text-sm font-semibold opacity-70 hover:opacity-100"
              onClick={addExpression}
            >
              Add Expression
            </button>
          </Show>
        </section>
      </div>
    </div>
  )
}
