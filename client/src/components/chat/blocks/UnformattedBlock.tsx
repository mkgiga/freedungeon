import type { UnformattedBlock as UnformattedBlockType } from '../blocks'
import { EditableText } from '../EditableText'

export function UnformattedBlock(props: {
    block: UnformattedBlockType
    onUpdate: (block: UnformattedBlockType) => void
}) {
    return (
        <div class="chat-block chat-block-unformatted">
            <EditableText
                class="chat-block-unformatted-content"
                initial={props.block.content}
                onCommit={(content) => props.onUpdate({ ...props.block, content })}
            />
        </div>
    )
}
