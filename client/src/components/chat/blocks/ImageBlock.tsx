import { createMemo, Show } from 'solid-js'
import { MdFillBroken_image } from 'solid-icons/md'
import type { Block, ImageBlock as ImageBlockType } from '../blocks'
import { state } from '../../../state'
import { EditableText } from '../EditableText'
import { useMediaViewer } from '../../MediaViewer'
import { Loader } from '../../Loader'
import { isImagePending } from './imagePending'

export function ImageBlock(props: {
    block: ImageBlockType
    onUpdate: (block: ImageBlockType) => void
    prevBlock?: Block
    interactive?: boolean
    messageId?: string
}) {
    const viewer = useMediaViewer()
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

    const pending = () => props.messageId !== undefined && isImagePending(props.messageId)

    const zoom = () => viewer.open({
        url: imageUrl(),
        title: props.block.caption || actor()?.name || undefined,
        type: 'image',
    })

    return (
        <div
            class="chat-block chat-block-image"
            classList={{
                [`is-${props.block.aspect}`]: props.block.aspect !== undefined,
                'is-caption-above': captionAbove(),
            }}
        >
            <Show when={imageUrl()} fallback={
                <div class="chat-block-image-slot" aria-label={pending() ? 'Generating image' : 'Image unavailable'}>
                    <Show when={pending()} fallback={<MdFillBroken_image size={28} />}>
                        <Loader size={28} />
                    </Show>
                </div>
            }>
            <img
                src={imageUrl()}
                alt={props.block.caption ?? props.block.src}
                classList={{ 'is-zoomable': props.interactive === true }}
                role={props.interactive ? 'button' : undefined}
                tabIndex={props.interactive ? 0 : undefined}
                onClick={props.interactive ? zoom : undefined}
                onKeyDown={props.interactive
                    ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); zoom() } }
                    : undefined}
            />
            </Show>
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
