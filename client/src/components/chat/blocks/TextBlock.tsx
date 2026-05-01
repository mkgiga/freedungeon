import { Show } from 'solid-js'
import type { TextBlock as TextBlockType } from '../blocks'
import { EditableText } from '../EditableText'
import { usePlayback } from '../playback'

export function TextBlock(props: {
    block: TextBlockType
    onUpdate: (block: TextBlockType) => void
    /** True only while this block is the currently-blocked-on block during
     *  playback. Reveal progress + tap routing are owned by the playback
     *  context — this component just renders what playback says is visible. */
    isActive?: boolean
    /** Kept for API compatibility; advance is now driven by the message-level
     *  click handler in ChatMessage via `playback.tap()`. */
    onAdvance?: () => void
}) {
    const playback = usePlayback()

    const revealedCount = () => (props.isActive ? playback.activeRevealedCount() : props.block.content.length)
    const isScrolling = () => props.isActive && playback.isActiveScrolling()

    return (
        <div class="chat-block chat-block-text" classList={{ 'chat-block-active': props.isActive }}>
            <Show
                when={props.isActive}
                fallback={
                    <EditableText
                        class="chat-block-text-content"
                        initial={props.block.content}
                        onCommit={(content) => props.onUpdate({ ...props.block, content })}
                    />
                }
            >
                <div class="chat-block-text-content chat-block-text-locked">
                    {props.block.content.slice(0, revealedCount())}
                    {/* Pending text is rendered with `visibility: hidden` so it
                     * still contributes to layout — the block sits at its
                     * final wrapped size from character 0 and the surrounding
                     * message height doesn't grow as the typewriter reveals. */}
                    <span class="chat-block-text-pending">
                        {props.block.content.slice(revealedCount())}
                    </span>
                    <Show when={!isScrolling()}>
                        <span class="chat-block-tap-indicator">▶</span>
                    </Show>
                </div>
            </Show>
        </div>
    )
}
