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
    /** True only while this block is the currently-blocked-on block during
     *  playback. Reveal progress + tap routing are owned by the playback
     *  context — this component just renders what playback says is visible. */
    isActive?: boolean
    /** Kept for API compatibility; advance is now driven by the message-level
     *  click handler in ChatMessage via `playback.tap()`. */
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

    /**
     * Ask the agent to describe this actor, as a mechanical user turn — the same
     * shape as a dropped item (tryUse) or a picked menu option (choice), rather
     * than typed prose the player has to phrase themselves.
     */
    const sendInspect = () => {
        const id = props.block.actorId
        if (!id || state.isGenerating) return
        // Same guard as dropping an item on an actor: this submits a turn, and
        // doing that with blocks still unread would bury dialogue the player
        // hasn't seen. Warn rather than skipAll() — opening a menu isn't a
        // statement that you're done reading.
        if (playback.hasUnread()) {
            toast.info('Finish the scene first.')
            return
        }
        trpc.chat.prompt.mutate({
            message: serializeBlocks([{ type: 'inspect', target: id }]),
        })
    }

    // Playback types out the same resolved string, so reveal counts line up.
    const shown = createMemo(() => resolveMentions(props.block.dialogue))

    const revealedCount = () => (props.isActive ? playback.activeRevealedCount() : shown().length)
    const isScrolling = () => props.isActive && playback.isActiveScrolling()

    // Presence per the replayed game state at this point in playback — not the
    // chat's cast list. An actor who has left the scene still has portraits in
    // the history above; acting on them is what's unavailable, not the record.
    const isInScene = createMemo(() => {
        const id = props.block.actorId
        if (!id) return false
        return playback.effectiveGameState().scene.actors.active[id] !== undefined
    })

    // Item drag-and-drop target: the portrait accepts drops only while its
    // actor is actually in the active scene (use_item rejects absent targets).
    const dropActorId = createMemo(() => (isInScene() ? props.block.actorId : undefined))

    const menuItems = () => [
        {
            label: 'Inspect',
            icon: <MdFillSearch size={16} />,
            onClick: sendInspect,
            // Disabled rather than dropped: the entry is how you learn the
            // action exists, and its absence would read as a rendering bug on
            // exactly the portraits where it matters most.
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
                    {/* Pending dialogue rendered with `visibility: hidden` so it
                     * contributes to layout (line wrapping + total height) without
                     * being painted. The block sits at its final size from char 0. */}
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
