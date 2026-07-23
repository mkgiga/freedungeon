import { createMemo, Show } from 'solid-js'
import type { SpeechBlock as SpeechBlockType } from '../blocks'
import { state } from '../../../state'
import { ImageIcon } from '../../ImageIcon'
import { useModal } from '../../Modal'
import { openExpressionPicker } from '../ExpressionPicker'
import { EditableText } from '../EditableText'
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
    const playback = usePlayback()

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

    const revealedCount = () => (props.isActive ? playback.activeRevealedCount() : props.block.dialogue.length)
    const isScrolling = () => props.isActive && playback.isActiveScrolling()

    // Item drag-and-drop target: the portrait accepts drops only while its
    // actor is actually in the active scene (use_item rejects absent targets).
    const dropActorId = createMemo(() => {
        const id = props.block.actorId
        if (!id) return undefined
        return playback.effectiveGameState().scene.actors.active[id] ? id : undefined
    })

    return (
        <div class="chat-block chat-block-speech" classList={{ 'chat-block-active': props.isActive }}>
            <button
                class="chat-block-avatar"
                data-drop-actor={dropActorId()}
                onClick={openPicker}
                disabled={!actor() || props.isActive}
                title={actor() && !props.isActive ? 'Change expression' : undefined}
            >
                <ImageIcon
                    url={avatarUrl()}
                    size={40}
                    placeholder={<div class="chat-block-avatar-fallback">{initials()}</div>}
                />
            </button>
            <div class="chat-block-name">
                {displayName()}
            </div>
            <Show
                when={props.isActive}
                fallback={
                    <EditableText
                        class="chat-block-dialogue"
                        initial={props.block.dialogue}
                        onCommit={(dialogue) => props.onUpdate({ ...props.block, dialogue })}
                    />
                }
            >
                <div class="chat-block-dialogue chat-block-dialogue-locked">
                    {props.block.dialogue.slice(0, revealedCount())}
                    {/* Pending dialogue rendered with `visibility: hidden` so it
                     * contributes to layout (line wrapping + total height) without
                     * being painted. The block sits at its final size from char 0. */}
                    <span class="chat-block-dialogue-pending">
                        {props.block.dialogue.slice(revealedCount())}
                    </span>
                    <Show when={!isScrolling()}>
                        <span class="chat-block-tap-indicator">▶</span>
                    </Show>
                </div>
            </Show>
        </div>
    )
}
