import { Show } from 'solid-js'
import type { PauseBlock as PauseBlockType } from '../blocks'

export function PauseBlock(props: {
    block: PauseBlockType
    onUpdate: (block: PauseBlockType) => void
    /** True only while this pause is the currently-blocked-on block during
     *  playback. Outside that window the component renders nothing — old
     *  pauses are invisible since they have no display content of their own. */
    isActive?: boolean
}) {
    return (
        <Show when={props.isActive}>
            <div class="chat-block chat-block-pause" aria-hidden="true">
                <span class="chat-block-pause-ellipsis">
                    <span class="chat-block-pause-dot">.</span>
                    <span class="chat-block-pause-dot">.</span>
                    <span class="chat-block-pause-dot">.</span>
                </span>
            </div>
        </Show>
    )
}
