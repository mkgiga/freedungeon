import { createMemo, Show } from 'solid-js'
import type { Block, ImageBlock as ImageBlockType } from '../blocks'
import { state } from '../../../state'
import { EditableText } from '../EditableText'

export function ImageBlock(props: {
    block: ImageBlockType
    onUpdate: (block: ImageBlockType) => void
    prevBlock?: Block
    portraitSide?: 'left' | 'right'
}) {
    const captionAbove = () =>
        props.block.aspect === 'landscape' && props.prevBlock?.type !== 'text'
    const actor = createMemo(() => {
        return Object.values(state.assets.actors ?? {}).find(a => a.customId === props.block.from) ?? null
    })

    const imageUrl = createMemo(() => {
        const a = actor()
        if (a?.expressions?.[props.block.src]) return a.expressions[props.block.src]
        return props.block.src
    })

    return (
        <div
            class="chat-block chat-block-image"
            classList={{
                [`is-${props.block.aspect}`]: props.block.aspect !== undefined,
                'is-caption-above': captionAbove(),
                'is-side-right': props.block.aspect === 'portrait' && props.portraitSide === 'right',
            }}
        >
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
