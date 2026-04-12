import type { PauseBlock as PauseBlockType } from '../blocks'

export function PauseBlock(props: {
    block: PauseBlockType
    onUpdate: (block: PauseBlockType) => void
}) {
    return (
        <div class="chat-block chat-block-pause">
            <div class="chat-block-pause-line" />
            <input
                class="chat-block-pause-input"
                type="number"
                min="0"
                step="0.1"
                value={props.block.seconds}
                onBlur={(e) => {
                    const val = Number(e.currentTarget.value)
                    if (!isNaN(val) && val !== props.block.seconds) {
                        props.onUpdate({ ...props.block, seconds: val })
                    }
                }}
            />
            <span class="chat-block-pause-unit">s</span>
            <div class="chat-block-pause-line" />
        </div>
    )
}
