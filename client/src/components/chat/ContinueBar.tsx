import { MdFillKeyboard_arrow_down } from 'solid-icons/md'
import { usePlayback } from './playback'
import { useAction, keybindLabel } from '../../actions'
import { Text } from '../typography/Text'
import { ShowOn } from '../ShowOn'

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
