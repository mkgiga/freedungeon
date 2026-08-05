import { createSignal, For, Show, type JSXElement } from 'solid-js'
import { createStore, produce } from 'solid-js/store'
import { MdFillMore_horiz, MdFillUpload } from 'solid-icons/md'

import { state } from '../state'
import { trpc } from '../trpc'
import { generateName } from '../utils/names'
import { Dropdown } from './Dropdown'
import { Heading } from './typography/Heading'
import { Text } from './typography/Text'
import { Em } from './typography/Em'
import { TextEditor } from './TextEditor'
import { ImageIcon } from './ImageIcon'
import { useMediaViewer } from './MediaViewer'

/** What the chrome needs to drive the editor it sits above. */
export type ActorEditorChrome = {
    name: string
    editing: boolean
    save: () => Promise<void>
}

/**
 * Viewer/editor for a single actor.
 *
 * Lives here rather than in /actors/$id because it has two homes: that route,
 * and a modal over the Scenario editor. Editing a character from a scenario
 * can't navigate — the editor holds an uncommitted draft that unmounting would
 * throw away — so the same UI has to be able to open in place.
 *
 * The host supplies its own chrome: a TopBar in the route, a save button in the
 * modal.
 */
export function ActorEditor(props: {
    customId: string
    edit: boolean
    chrome?: (ctx: ActorEditorChrome) => JSXElement
    /** Rendered below the body — where a modal puts its Cancel/Save rail. */
    footer?: (ctx: ActorEditorChrome) => JSXElement
    /** Called after a successful save with the (possibly renamed) customId. */
    onSaved?: (customId: string) => void
}) {
    const mediaViewer = useMediaViewer()

    const serverActor = () => Object.values(state.assets.actors ?? {}).find(a => a.customId === props.customId)
    const isNew = () => !serverActor()

    const [draft, setDraft] = createStore<{
        id: string
        customId: string
        name: string
        description: string
        avatarUrl: string
        group?: string
        expressions: Record<string, string>
        createdAt: number
        updatedAt: number
    }>(
        serverActor() ?? {
            id: '',
            customId: props.customId,
            name: 'New Actor',
            description: '',
            avatarUrl: '',
            group: undefined,
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
            group: draft.group,
            expressions: draft.expressions as Record<string, string>,
        })
        props.onSaved?.(result.customId)
    }

    const initials = () => draft.name?.charAt(0)?.toUpperCase() ?? '?'

    // Rename an expression. Expressions are keyed by name, so this rebuilds the
    // record with the key swapped — iterating preserves insertion order, so the
    // renamed row stays put instead of jumping to the end. Committed to the draft
    // only (persists on Save). Caller guards against empty/duplicate names.
    const renameExpression = (oldName: string, newName: string) => {
        if (newName === oldName) return
        const rebuilt: Record<string, string> = {}
        for (const [k, v] of Object.entries(draft.expressions ?? {})) {
            rebuilt[k === oldName ? newName : k] = v
        }
        setDraft('expressions', rebuilt)
    }

    /** Prompt for a file and upload it. Resolves to the stored URL, or null. */
    const pickImage = () => new Promise<string | null>((resolve) => {
        const input = document.createElement('input')
        input.type = 'file'
        input.accept = 'image/*'
        input.onchange = async () => {
            const file = input.files?.[0]
            if (!file) return resolve(null)
            const formData = new FormData()
            formData.append('file', file)
            const res = await fetch('/uploads', { method: 'POST', body: formData })
            resolve(res.ok ? (await res.json()).url : null)
        }
        input.click()
    })

    // Adds the row straight away rather than gating it behind a dialog: the
    // name is editable in place and the image slot is one click, so a form that
    // demands both up front is a detour. The image starts empty and shows an
    // upload target until one is picked.
    const addExpression = () => {
        const name = generateName({
            input: 'new_expression',
            separator: '_',
            existingNames: Object.keys(draft.expressions ?? {}),
        })
        setDraft('expressions', name, '')
    }

    const setExpressionImage = async (name: string) => {
        const url = await pickImage()
        if (url) setDraft('expressions', name, url)
    }

    return (
        <div class="flex flex-col h-full overflow-hidden">
            {props.chrome?.({ get name() { return draft.name }, editing: props.edit, save })}

            <div class="flex-1 overflow-y-auto overflow-x-hidden p-4">
                {/* Header card — avatar + name + ID */}
                <section class="flex items-start gap-4 mb-6">
                    <div
                        class="relative block cursor-pointer"
                        onClick={() => {
                            if (props.edit) {
                                const input = document.createElement('input')
                                input.type = 'file'
                                input.accept = 'image/*'
                                input.onchange = async () => {
                                    const file = input.files?.[0]
                                    if (!file) return
                                    const formData = new FormData()
                                    formData.append('file', file)
                                    const res = await fetch('/uploads', {
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
                                    <Show when={props.edit} fallback={<Text size="sm" class="opacity-50 text-center">{initials()}</Text>}>
                                        <MdFillUpload size={24} class="opacity-40" />
                                    </Show>
                                </div>
                            }
                        />
                        <Show when={props.edit && draft.avatarUrl}>
                            <div class="absolute inset-0 flex items-center justify-center bg-black/50 rounded-lg opacity-0 hover:opacity-100 transition-opacity">
                                <Text size="sm"><Em semibold>Change</Em></Text>
                            </div>
                        </Show>
                    </div>
                    <div class="flex flex-col gap-1">
                        <Show when={props.edit} fallback={<Heading level={1}>{draft.name}</Heading>}>
                            <input
                                type="text"
                                value={draft.name}
                                class="text-xl font-bold bg-transparent rounded p-1 outline-none focus:ring focus:ring-(--primary)"
                                onInput={(e) => setDraft('name', e.currentTarget.value)}
                            />
                        </Show>
                        <Text size="sm" class="opacity-50 flex items-center gap-1">
                            ID
                            <Show when={props.edit} fallback={<Text size="sm" font="mono" class="opacity-70">{draft.customId}</Text>}>
                                <input
                                    type="text"
                                    value={draft.customId}
                                    class="font-mono text-sm bg-transparent border-b border-(--primary) outline-none opacity-70 focus:opacity-100"
                                    onInput={(e) => setDraft('customId', e.currentTarget.value)}
                                />
                            </Show>
                        </Text>
                        <Text size="sm" class="opacity-50 flex items-center gap-1">
                            Group
                            <Show when={props.edit} fallback={<Text size="sm" class="opacity-70">{draft.group ?? '—'}</Text>}>
                                <input
                                    type="text"
                                    value={draft.group ?? ''}
                                    placeholder="e.g. Party, Enemies, NPCs"
                                    class="text-sm bg-transparent border-b border-(--primary) outline-none opacity-70 focus:opacity-100"
                                    onInput={(e) => setDraft('group', e.currentTarget.value || undefined)}
                                />
                            </Show>
                        </Text>
                    </div>
                </section>

                {/* Description */}
                <section class="mb-6">
                    <TextEditor
                        title="Description"
                        description="Who they are and how they behave."
                        value={() => draft.description}
                        onInput={(v) => setDraft('description', v)}
                        readOnly={!props.edit}
                    />
                </section>

                {/* Expressions */}
                <section>
                    <Heading level={2} class="mb-1">Expressions</Heading>
                    <Show when={Object.keys(draft.expressions ?? {}).length > 0} fallback={
                        <Text size="sm" class="opacity-50 mb-3">No expressions yet.</Text>
                    }>
                        <table class="w-full text-sm">
                            <thead>
                                <tr class="border-b border-[color-mix(in_oklch,var(--text),transparent_85%)]">
                                    <th class="text-left py-2">Preview</th>
                                    <th class="text-left py-2">Name</th>
                                    <Show when={props.edit}><th class="text-right py-2">Actions</th></Show>
                                </tr>
                            </thead>
                            <tbody>
                                <For each={Object.entries(draft.expressions ?? {})}>
                                    {([name, url]) => (
                                        <tr class="border-b border-[color-mix(in_oklch,var(--text),transparent_90%)]">
                                            <td class="py-2">
                                                <button
                                                    type="button"
                                                    class="expression-image"
                                                    disabled={!props.edit}
                                                    title={props.edit ? 'Change image' : undefined}
                                                    onClick={() => setExpressionImage(name)}
                                                >
                                                    <Show
                                                        when={url}
                                                        fallback={<MdFillUpload size={16} class="opacity-40" />}
                                                    >
                                                        <img src={url as string} alt={name} />
                                                    </Show>
                                                </button>
                                            </td>
                                            <td class="py-2">
                                                <Show when={props.edit} fallback={<span>{name}</span>}>
                                                    {(() => {
                                                        // Local buffer so each keystroke doesn't re-key the
                                                        // record (which would reorder rows + drop focus). Commit
                                                        // on blur/Enter; revert on empty, no-op, duplicate, or Esc.
                                                        const [val, setVal] = createSignal(name)
                                                        const commit = () => {
                                                            const trimmed = val().trim()
                                                            if (!trimmed || trimmed === name || draft.expressions[trimmed] !== undefined) {
                                                                setVal(name)
                                                                return
                                                            }
                                                            renameExpression(name, trimmed)
                                                        }
                                                        return (
                                                            <input
                                                                type="text"
                                                                value={val()}
                                                                class="text-sm bg-transparent border-b border-(--primary) outline-none opacity-70 focus:opacity-100"
                                                                onInput={(e) => setVal(e.currentTarget.value)}
                                                                onBlur={commit}
                                                                onKeyDown={(e) => {
                                                                    if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur() }
                                                                    else if (e.key === 'Escape') { setVal(name); e.currentTarget.blur() }
                                                                }}
                                                            />
                                                        )
                                                    })()}
                                                </Show>
                                            </td>
                                            <Show when={props.edit}>
                                                <td class="py-2 text-right">
                                                    <Dropdown
                                                        trigger={<MdFillMore_horiz size={20} />}
                                                        items={[
                                                            {
                                                                label: 'Remove',
                                                                danger: true,
                                                                onClick: () => {
                                                                    setDraft('expressions', produce((exprs: Record<string, string>) => {
                                                                        delete exprs[name]
                                                                    }))
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
                    <Show when={props.edit}>
                        <button
                            class="mt-2 p-2 w-full flex items-center justify-center rounded-lg border-2! border-dashed! border-[color-mix(in_oklch,var(--text),transparent_70%)]!"
                            onClick={addExpression}
                        >
                            Add Expression
                        </button>
                    </Show>
                </section>
            </div>

            {props.footer?.({ get name() { return draft.name }, editing: props.edit, save })}
        </div>
    )
}
