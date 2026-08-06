import { onCleanup, onMount } from 'solid-js'
import { MdFillKeyboard_arrow_down } from 'solid-icons/md'
import { usePlayback } from './playback'
import { Text } from '../typography/Text'
import { ShowOn } from '../ShowOn'

/**
 * Stands in for the composer while blocks are still unread.
 *
 * The blinking triangle on the active line wasn't enough on its own — a tester
 * typed a prompt without realising the scene was still playing, because the
 * text box being there is an invitation to use it. Taking the box away and
 * putting the advance control where the user's hands already are makes the
 * state unmissable, and makes "read the rest" the only move.
 */
export function ContinueBar() {
    const playback = usePlayback()

    // Space and Enter advance too — on desktop the pointer is rarely near the
    // bar, and holding one key through a scene beats hunting for it.
    const onKeydown = (e: KeyboardEvent) => {
        if (e.key !== ' ' && e.key !== 'Enter') return
        const target = e.target as HTMLElement | null
        // A modal over the chat (director's note, confirms) owns its own keys.
        if (target?.closest('input, textarea, [contenteditable="true"], .modal-overlay')) return
        e.preventDefault()
        playback.tap()
    }

    onMount(() => document.addEventListener('keydown', onKeydown))
    onCleanup(() => document.removeEventListener('keydown', onKeydown))

    return (
        <button type="button" class="continue-bar" onClick={() => playback.tap()}>
            <MdFillKeyboard_arrow_down size={20} class="continue-bar-caret" />
            <Text size="sm">
                {playback.isActiveScrolling() ? 'Tap to reveal' : 'Tap to continue'}
            </Text>
            <ShowOn viewport={['tablet', 'wide']}>
                <kbd class="continue-bar-key">Space</kbd>
            </ShowOn>
        </button>
    )
}
