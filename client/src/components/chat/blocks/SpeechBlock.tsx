import { createMemo, createSignal, Show } from 'solid-js'
import { MdFillSearch, MdFillMood } from 'solid-icons/md'
import type { SpeechBlock as SpeechBlockType } from '../blocks'
import { serializeBlocks } from '../blocks'
import { state } from '../../../state'
import { trpc } from '../../../trpc'
import { ImageIcon } from '../../ImageIcon'
import { useModal } from '../../Modal'
import { useToast } from '../../Toast'
import { AnchoredMenu } from '../../Dropdown'
import { openExpressionPicker } from '../ExpressionPicker'
import { EditableText } from '../EditableText'
import { resolveMentions } from '../mentions'
import { usePlayback } from '../playback'

export function SpeechBlock(props: {
    block: SpeechBlockType
    onUpdate: (block: SpeechBlockType) => void
    isActive?: boolean
    onAdvance?: () => void
}) {
    const modal = useModal()
    const toast = useToast()
    const playback = usePlayback()
    const [menuAnchor, setMenuAnchor] = createSignal<HTMLElement | null>(null)

    const actor = createMemo(() => {
        if (!props.block.actorId) return null
        return Object.values(state.assets.actors ?? {}).find(a => a.customId === props.block.actorId) ?? null
    })

    const displayName = createMemo(() => props.block.name ?? actor()?.name ?? props.block.actorId ?? 'Unknown')

    const avatarUrl = createMemo(() => {
        const a = actor()
        if (!a) return undefined
        if (props.block.expression && a.expressions?.[props.block.expression]) {
            return a.expressions[props.block.expression]
        }
        return a.avatarUrl || undefined
    })

    const initials = () => displayName().charAt(0)?.toUpperCase() ?? '?'

    const openPicker = () => {
        const a = actor()
        if (!a) return
        openExpressionPicker({
            modal,
            actor: a,
            current: props.block.expression,
            onPick: (expression) => {
                props.onUpdate({ ...props.block, expression })
            },
        })
    }

    const sendInspect = () => {
        const id = props.block.actorId
        if (!id || state.isGenerating) return
        if (playback.hasUnread()) {
            toast.info('Finish the scene first.')
            return
        }
        trpc.chat.prompt.mutate({
            message: serializeBlocks([{ type: 'inspect', target: id }]),
        })
    }

    const shown = createMemo(() => resolveMentions(props.block.dialogue))

    const revealedCount = () => (props.isActive ? playback.activeRevealedCount() : shown().length)
    const isScrolling = () => props.isActive && playback.isActiveScrolling()

    const isInScene = createMemo(() => {
        const id = props.block.actorId
        if (!id) return false
        return playback.effectiveGameState().scene.actors.active[id] !== undefined
    })

    const dropActorId = createMemo(() => (isInScene() ? props.block.actorId : undefined))

    const menuItems = () => [
        {
            label: 'Inspect',
            icon: <MdFillSearch size={16} />,
            onClick: sendInspect,
            disabled: !isInScene() || state.isGenerating,
            title: !isInScene()
                ? `${displayName()} is not in the scene right now.`
                : state.isGenerating
                    ? 'Wait for the current turn to finish.'
                    : `Ask what ${displayName()} looks like right now`,
        },
        {
            label: 'Change expression',
            icon: <MdFillMood size={16} />,
            onClick: openPicker,
        },
    ]

    return (
        <div class="chat-block chat-block-speech" classList={{ 'chat-block-active': props.isActive }}>
            <button
                class="chat-block-avatar"
                data-drop-actor={dropActorId()}
                onClick={(e) => setMenuAnchor(prev => (prev ? null : e.currentTarget))}
                disabled={!actor() || props.isActive}
                title={actor() && !props.isActive ? `${displayName()} — actions` : undefined}
            >
                <ImageIcon
                    url={avatarUrl()}
                    size={40}
                    placeholder={<div class="chat-block-avatar-fallback">{initials()}</div>}
                />
            </button>
            <Show when={menuAnchor()}>
                {(anchor) => (
                    <AnchoredMenu
                        anchor={anchor()}
                        items={menuItems()}
                        onClose={() => setMenuAnchor(null)}
                    />
                )}
            </Show>
            <div class="chat-block-name">
                {displayName()}
            </div>
            <Show
                when={props.isActive}
                fallback={
                    <EditableText
                        class="chat-block-dialogue"
                        initial={props.block.dialogue}
                        display={shown()}
                        onCommit={(dialogue) => props.onUpdate({ ...props.block, dialogue })}
                    />
                }
            >
                <div class="chat-block-dialogue chat-block-dialogue-locked">
                    {shown().slice(0, revealedCount())}
                    <span class="chat-block-dialogue-pending">
                        {shown().slice(revealedCount())}
                    </span>
                    <Show when={!isScrolling()}>
                        <span class="chat-block-tap-indicator">▶</span>
                    </Show>
                </div>
            </Show>
        </div>
    )
}
