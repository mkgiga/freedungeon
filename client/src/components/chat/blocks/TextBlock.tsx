import type { TextBlock as TextBlockType } from '../blocks'
import { EditableText } from '../EditableText'

export function TextBlock(props: {
    block: TextBlockType
    onUpdate: (block: TextBlockType) => void
}) {
    return (
        <div class="chat-block chat-block-text">
            <EditableText
                class="chat-block-text-content"
                initial={props.block.content}
                onCommit={(content) => props.onUpdate({ ...props.block, content })}
            />
        </div>
    )
}
