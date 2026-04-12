import { Show } from 'solid-js'
import type { TextBlock as TextBlockType } from '../blocks'
import { EditableText } from '../EditableText'

export function TextBlock(props: {
    block: TextBlockType
    onUpdate: (block: TextBlockType) => void
}) {
    return (
        <div class="chat-block chat-block-text">
            <Show when={props.block.icon}>
                <div class="chat-block-text-icon" title={props.block.icon}>
                    {/* Placeholder for Lucide icon rendering; shows name as a chip for now */}
                    <span>{props.block.icon}</span>
                </div>
            </Show>
            <EditableText
                class="chat-block-text-content"
                initial={props.block.content}
                onCommit={(content) => props.onUpdate({ ...props.block, content })}
            />
        </div>
    )
}
