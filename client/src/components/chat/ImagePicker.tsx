import { createMemo, createSignal, For, Show } from 'solid-js'
import { state } from '../../state'
import { trpc } from '../../trpc'
import { MdFillUpload } from 'solid-icons/md'
import { Text } from '../typography/Text'
import { Em } from '../typography/Em'
import type { ImageAsset } from '@shared/types'

function slugify(label: string): string {
    const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
    return /^[a-z]/.test(slug) ? slug : `img_${slug}`
}

export function ImagePicker(props: {
    selected: () => string[]
    onToggle: (image: ImageAsset) => void
}) {
    const [query, setQuery] = createSignal('')
    const [pending, setPending] = createSignal<{ url: string; label: string; key: string } | null>(null)
    const [error, setError] = createSignal('')

    const items = createMemo<ImageAsset[]>(() => {
        const q = query().toLowerCase().trim()
        return Object.values(state.assets.images ?? {})
            .filter(i => !q || i.label.toLowerCase().includes(q) || i.key.toLowerCase().includes(q))
            .sort((a, b) => a.label.localeCompare(b.label))
    })

    const added = () => new Set(props.selected())

    const pickAndUpload = () => {
        const input = document.createElement('input')
        input.type = 'file'
        input.accept = 'image/*'
        input.onchange = async () => {
            const file = input.files?.[0]
            if (!file) return
            const formData = new FormData()
            formData.append('file', file)
            const res = await fetch('/uploads', { method: 'POST', body: formData })
            if (!res.ok) {
                setError('Upload failed')
                return
            }
            const { url } = await res.json()
            const label = file.name.replace(/\.[^.]+$/, '')
            setError('')
            setPending({ url, label, key: slugify(label) })
        }
        input.click()
    }

    const confirmPending = async () => {
        const draft = pending()
        if (!draft) return
        try {
            const image = await trpc.images.create.mutate({
                key: draft.key,
                label: draft.label,
                url: draft.url,
            })
            setPending(null)
            setError('')
            props.onToggle(image)
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err))
        }
    }

    return (
        <div class="min-h-0 min-w-0 h-full w-full max-w-[520px] overflow-y-auto flex flex-col gap-3">
            <Show
                when={pending()}
                fallback={
                    <>
                        <div class="flex items-center gap-2">
                            <input
                                type="text"
                                placeholder="Search images…"
                                value={query()}
                                onInput={(e) => setQuery(e.currentTarget.value)}
                                class="flex-1 p-2 rounded-lg bg-(--bg) border border-[color-mix(in_oklch,var(--text),transparent_85%)]"
                            />
                            <button class="modal-btn modal-btn-confirm" onClick={pickAndUpload}>
                                <MdFillUpload size={18} /> Upload
                            </button>
                        </div>

                        <Show when={error()}>
                            <Text size="sm" class="text-emphasis-danger">{error()}</Text>
                        </Show>

                        <div class="image-picker-grid">
                            <For each={items()} fallback={<Text size="sm" class="opacity-50">No images yet — upload one.</Text>}>
                                {(image) => (
                                    <button
                                        class="image-picker-item"
                                        classList={{ 'is-selected': added().has(image.id) }}
                                        onClick={() => props.onToggle(image)}
                                    >
                                        <img src={image.url} alt="" />
                                        <Text size="sm" class="truncate w-full">{image.label}</Text>
                                        <Text size="sm" font="mono" class="opacity-50 truncate w-full">{image.key}</Text>
                                    </button>
                                )}
                            </For>
                        </div>
                    </>
                }
            >
                {(draft) => (
                    <div class="flex flex-col gap-3">
                        <img src={draft().url} alt="" class="image-picker-preview" />
                        <label class="flex flex-col gap-1">
                            <Text size="sm" class="opacity-50">Label</Text>
                            <input
                                type="text"
                                value={draft().label}
                                class="p-2 rounded-lg bg-(--bg) border border-[color-mix(in_oklch,var(--text),transparent_85%)]"
                                onInput={(e) => setPending({ ...draft(), label: e.currentTarget.value, key: slugify(e.currentTarget.value) })}
                            />
                        </label>
                        <label class="flex flex-col gap-1">
                            <Text size="sm" class="opacity-50">Key <Em type="muted">— the agent's name for it</Em></Text>
                            <input
                                type="text"
                                value={draft().key}
                                class="p-2 rounded-lg bg-(--bg) border border-[color-mix(in_oklch,var(--text),transparent_85%)] font-mono"
                                onInput={(e) => setPending({ ...draft(), key: e.currentTarget.value })}
                            />
                        </label>
                        <Show when={error()}>
                            <Text size="sm" class="text-emphasis-danger">{error()}</Text>
                        </Show>
                        <div class="modal-confirm-actions">
                            <button class="modal-btn modal-btn-cancel" onClick={() => { setPending(null); setError('') }}>Cancel</button>
                            <button class="modal-btn modal-btn-confirm" onClick={confirmPending}>Add to library</button>
                        </div>
                    </div>
                )}
            </Show>
        </div>
    )
}
