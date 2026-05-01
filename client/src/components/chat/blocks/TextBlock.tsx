import { createEffect, createSignal, on, onCleanup, Show } from 'solid-js'
import type { TextBlock as TextBlockType } from '../blocks'
import { EditableText } from '../EditableText'

const TYPEWRITER_MS_PER_CHAR = 25

export function TextBlock(props: {
    block: TextBlockType
    onUpdate: (block: TextBlockType) => void
    /** True only while this block is the currently-blocked-on block during
     *  playback. Drives the typewriter reveal and locks the EditableText so
     *  taps act as playback controls instead of entering edit mode. */
    isActive?: boolean
    /** Called when the user taps an active, fully-revealed block. */
    onAdvance?: () => void
}) {
    const [revealedCount, setRevealedCount] = createSignal(0)

    // Reset and run the typewriter every time isActive flips true. `on` keys
    // the effect on isActive specifically — content changes while active are
    // ignored (the assumption is that an in-flight playback owns the text).
    createEffect(on(() => props.isActive, (active) => {
        if (!active) return
        const text = props.block.content
        setRevealedCount(0)
        if (text.length === 0) return
        const timer = setInterval(() => {
            setRevealedCount(c => {
                const next = c + 1
                if (next >= text.length) clearInterval(timer)
                return next
            })
        }, TYPEWRITER_MS_PER_CHAR)
        onCleanup(() => clearInterval(timer))
    }))

    const isScrolling = () => props.isActive && revealedCount() < props.block.content.length

    const handleClick = () => {
        if (!props.isActive) return
        if (isScrolling()) {
            setRevealedCount(props.block.content.length)
        } else {
            props.onAdvance?.()
        }
    }

    return (
        <div
            class="chat-block chat-block-text"
            classList={{ 'chat-block-active': props.isActive }}
            onClick={handleClick}
        >
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
