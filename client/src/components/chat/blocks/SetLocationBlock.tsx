import type { SetLocationBlock as SetLocationBlockType } from '../blocks'

export function SetLocationBlock(props: {
    block: SetLocationBlockType
    onUpdate: (block: SetLocationBlockType) => void
}) {
    return (
        <div
            class="chat-block chat-block-scene-break"
            role="separator"
            aria-label={`Scene: ${props.block.description}`}
        >
            <span class="chat-block-scene-break-line" aria-hidden="true" />
            <span class="chat-block-scene-break-label">{props.block.description}</span>
            <span class="chat-block-scene-break-line" aria-hidden="true" />
        </div>
    )
}
