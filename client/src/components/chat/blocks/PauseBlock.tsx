import type { PauseBlock as PauseBlockType } from '../blocks'

export function PauseBlock(props: {
    block: PauseBlockType
    onUpdate: (block: PauseBlockType) => void
    /** True only while this pause is the currently-blocked-on block during
     *  playback. Toggles the ellipsis between visible (animated) and hidden;
     *  the layout footprint stays constant either way (see styles.css). */
    isActive?: boolean
}) {
    // The outer container always renders at 0 height — its only purpose is to
    // hold a flex slot in the message so the gap above and below stays
    // constant. The ellipsis inside is `position: absolute` so its presence
    // never contributes height; visibility flips it on/off.
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
