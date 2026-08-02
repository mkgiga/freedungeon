import { createMemo, Show } from 'solid-js'
import type { Block, ImageBlock as ImageBlockType } from '../blocks'
import { state } from '../../../state'
import { EditableText } from '../EditableText'

export function ImageBlock(props: {
    block: ImageBlockType
    onUpdate: (block: ImageBlockType) => void
    /** What the reader saw immediately before this image — see captionAbove. */
    prevBlock?: Block
    /** Which edge a portrait image hugs; the feed alternates it. */
    portraitSide?: 'left' | 'right'
}) {
    /**
     * A landscape image spans the reading column, so a caption sitting under it
     * right below a paragraph reads as a third stacked block of prose. When the
     * preceding block is narration, lift the caption above the image instead —
     * the picture breaks the two runs of text apart. Any other neighbour
     * (dialogue, another image, a state beat) leaves the caption below, where
     * captions normally belong.
     */
    const captionAbove = () =>
        props.block.aspect === 'landscape' && props.prevBlock?.type !== 'text'
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
