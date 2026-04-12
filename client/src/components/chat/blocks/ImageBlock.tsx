import { createMemo, Show } from 'solid-js'
import type { ImageBlock as ImageBlockType } from '../blocks'
import { state } from '../../../state'
import { EditableText } from '../EditableText'

export function ImageBlock(props: {
    block: ImageBlockType
    onUpdate: (block: ImageBlockType) => void
}) {
    const actor = createMemo(() => {
        return Object.values(state.assets.actors ?? {}).find(a => a.customId === props.block.from) ?? null
    })

    // Try resolving src as an expression name first; fall back to the raw src (URL or filename)
    const imageUrl = createMemo(() => {
        const a = actor()
        if (a?.expressions?.[props.block.src]) return a.expressions[props.block.src]
        return props.block.src
    })

    return (
        <div class="chat-block chat-block-image">
            <img src={imageUrl()} alt={props.block.caption ?? props.block.src} />
            <Show when={props.block.caption !== undefined}>
                <EditableText
                    class="chat-block-image-caption"
                    initial={props.block.caption ?? ''}
                    onCommit={(caption) => props.onUpdate({ ...props.block, caption })}
                />
            </Show>
        </div>
    )
}
