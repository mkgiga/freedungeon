import { createMemo, Show } from 'solid-js'
import type { TextBlock as TextBlockType } from '../blocks'
import { EditableText } from '../EditableText'
import { resolveMentions } from '../mentions'
import { usePlayback } from '../playback'

export function TextBlock(props: {
    block: TextBlockType
    onUpdate: (block: TextBlockType) => void
    isActive?: boolean
    onAdvance?: () => void
}) {
    const playback = usePlayback()

    const shown = createMemo(() => resolveMentions(props.block.content))

    const revealedCount = () => (props.isActive ? playback.activeRevealedCount() : shown().length)
    const isScrolling = () => props.isActive && playback.isActiveScrolling()

    return (
        <div class="chat-block chat-block-text" classList={{ 'chat-block-active': props.isActive }}>
            <Show
                when={props.isActive}
                fallback={
                    <EditableText
                        class="chat-block-text-content"
                        initial={props.block.content}
                        display={shown()}
                        onCommit={(content) => props.onUpdate({ ...props.block, content })}
                    />
                }
            >
                <div class="chat-block-text-content chat-block-text-locked">
                    {shown().slice(0, revealedCount())}
                    <span class="chat-block-text-pending">
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
