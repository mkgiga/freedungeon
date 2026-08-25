import { MdFillKeyboard_arrow_down } from 'solid-icons/md'
import { usePlayback } from './playback'
import { useAction, keybindLabel } from '../../actions'
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

    useAction('chat.advance', () => playback.tap())

    return (
        <button type="button" class="continue-bar" onClick={() => playback.tap()}>
            <MdFillKeyboard_arrow_down size={20} class="continue-bar-caret" />
            <Text size="sm">
                {playback.isActiveScrolling() ? 'Tap to reveal' : 'Tap to continue'}
            </Text>
            <ShowOn viewport={['tablet', 'wide']}>
<kbd class="continue-bar-key">{keybindLabel('chat.advance') ?? '—'}</kbd>
            </ShowOn>
        </button>
    )
}
