import { createSignal, For, Show, type JSXElement } from 'solid-js'
import { createStore, produce } from 'solid-js/store'
import { MdFillMore_horiz, MdFillUpload } from 'solid-icons/md'

import { state } from '../state'
import { trpc } from '../trpc'
import type { Actor } from '@shared/types'
import { generateName } from '../utils/names'
import { createImageDrop, pickImage } from '../utils/imageUpload'
import { Dropdown } from './Dropdown'
import { Heading } from './typography/Heading'
import { Text } from './typography/Text'
import { Em } from './typography/Em'
import { TextEditor } from './TextEditor'
import { ImageIcon } from './ImageIcon'
import { useMediaViewer } from './MediaViewer'
import { useToast } from './Toast'

function ExpressionImage(props: {
    name: string
    url: string
    onPick: () => void
    onDrop: (url: string) => void
}) {
    const drop = createImageDrop((url) => props.onDrop(url), () => true)
    return (
        <button
            type="button"
            class="expression-image"
            classList={{ 'is-drop-target': drop.over() }}
            title="Change image"
            onClick={props.onPick}
            {...drop.handlers}
        >
            <Show when={props.url} fallback={<MdFillUpload size={16} class="opacity-40" />}>
                <img src={props.url} alt={props.name} />
            </Show>
        </button>
    )
}

export type ActorEditorChrome = {
    name: string
    save: () => Promise<void>
}

export function ActorEditor(props: {
    customId: string
    chrome?: (ctx: ActorEditorChrome) => JSXElement
    footer?: (ctx: ActorEditorChrome) => JSXElement
    homeChatId?: string | null
    onSaved?: (actor: Actor) => void
}) {
    const mediaViewer = useMediaViewer()
    const toast = useToast()

    const serverActor = () => Object.values(state.assets.actors ?? {}).find(a => a.customId === props.customId)
    const isNew = () => !serverActor()

    const [draft, setDraft] = createStore<{
        id: string
        customId: string
        name: string
        description: string
        avatarUrl: string
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
            expressions: {} as Record<string, string>,
            createdAt: Date.now(),
            updatedAt: Date.now(),
        }
    )

    // Rethrows after reporting: callers that close a modal on success have to
    // stay open on failure, and the draft is only in memory.
    const save = async () => {
        try {
            const result = await trpc.actors.upsert.mutate({
                id: isNew() ? undefined : draft.id,
                name: draft.name,
                description: draft.description,
                avatarUrl: draft.avatarUrl,
                customId: draft.customId,
                expressions: draft.expressions as Record<string, string>,
                ...(props.homeChatId !== undefined ? { homeChatId: props.homeChatId } : {}),
            })
            toast.success(`${draft.name?.trim() || 'Character'} saved`)
            props.onSaved?.(result as Actor)
        } catch (e) {
            toast.error((e as Error).message || 'Could not save this character.')
            throw e
        }
    }

    const renameExpression = (oldName: string, newName: string) => {
        if (newName === oldName) return
        const rebuilt: Record<string, string> = {}
        for (const [k, v] of Object.entries(draft.expressions ?? {})) {
            rebuilt[k === oldName ? newName : k] = v
        }
        setDraft(produce((d) => { d.expressions = rebuilt }))
    }

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

    const avatarDrop = createImageDrop(
        (url) => setDraft('avatarUrl', url),
        () => true,
    )

    return (
        <div class="flex flex-col h-full overflow-hidden">
            {props.chrome?.({ get name() { return draft.name }, save })}

            <div class="flex-1 overflow-y-auto overflow-x-hidden p-4">
                <section class="flex items-start gap-4 mb-6">
                    <div
                        class="relative block cursor-pointer"
                        classList={{ 'is-drop-target': avatarDrop.over() }}
                        {...avatarDrop.handlers}
                        onClick={async () => {
                            if (true) {
                                const url = await pickImage()
                                if (url) setDraft('avatarUrl', url)
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
                                    <MdFillUpload size={24} class="opacity-40" />
                                </div>
                            }
                        />
                        <Show when={draft.avatarUrl}>
                            <div class="absolute inset-0 flex items-center justify-center bg-black/50 rounded-lg opacity-0 hover:opacity-100 transition-opacity">
                                <Text size="sm"><Em semibold>Change</Em></Text>
                            </div>
                        </Show>
                    </div>
                    <div class="flex flex-col gap-1">
                        <input
                            type="text"
                            value={draft.name}
                            class="text-xl font-bold bg-transparent rounded p-1 outline-none focus:ring focus:ring-(--primary)"
                            onInput={(e) => setDraft('name', e.currentTarget.value)}
                        />
                        <Text size="sm" class="opacity-50 flex items-center gap-1">
                            ID
                            <input
                                type="text"
                                value={draft.customId}
                                class="font-mono text-sm bg-transparent border-b border-(--primary) outline-none opacity-70 focus:opacity-100"
                                onInput={(e) => setDraft('customId', e.currentTarget.value)}
                            />
                        </Text>
                    </div>
                </section>

                <section class="mb-6">
                    <TextEditor
                        title="Description"
                        description="Who they are and how they behave."
                        value={() => draft.description}
                        onInput={(v) => setDraft('description', v)}
                        readOnly={false}
                    />
                </section>

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
                                    <th class="text-right py-2">Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                <For each={Object.entries(draft.expressions ?? {})}>
                                    {([name, url]) => (
                                        <tr class="border-b border-[color-mix(in_oklch,var(--text),transparent_90%)]">
                                            <td class="py-2">
                                                <ExpressionImage
                                                    name={name}
                                                    url={url as string}
                                                    onPick={() => setExpressionImage(name)}
                                                    onDrop={(u) => setDraft('expressions', name, u)}
                                                />
                                            </td>
                                            <td class="py-2">
                                                {(() => {
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
                                            </td>
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
                                        </tr>
                                    )}
                                </For>
                            </tbody>
                        </table>
                    </Show>
                    <button
                        class="mt-2 p-2 w-full flex items-center justify-center rounded-lg border-2! border-dashed! border-[color-mix(in_oklch,var(--text),transparent_70%)]!"
                        onClick={addExpression}
                    >
                        Add Expression
                    </button>
                </section>
            </div>

            {props.footer?.({ get name() { return draft.name }, save })}
        </div>
    )
}
