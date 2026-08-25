import type { PauseBlock as PauseBlockType } from '../blocks'

export function PauseBlock(props: {
    block: PauseBlockType
    onUpdate: (block: PauseBlockType) => void
    isActive?: boolean
}) {
    return (
        <div class="chat-block chat-block-pause" aria-hidden="true">
            <span
                class="chat-block-pause-ellipsis"
                classList={{ 'is-active': props.isActive }}
            >
                <span class="chat-block-pause-dot">.</span>
                <span class="chat-block-pause-dot">.</span>
                <span class="chat-block-pause-dot">.</span>
            </span>
        </div>
    )
}
