import type { TryUseBlock as TryUseBlockType } from '../blocks'
import { state } from '../../../state'
import { pickEmojiForItem } from '../inventory/itemEmoji'

/**
 * A drag-and-drop use attempt — rendered as a chip like ChoiceBlock so it
 * reads as a distinct user action, not typed dialogue. The agent's answering
 * useItem / narration blocks carry the outcome.
 */
export function TryUseBlock(props: {
    block: TryUseBlockType
    onUpdate: (block: TryUseBlockType) => void
}) {
    // "item:Potion" / "actor:vega" — strip the kind prefix, keep the ref.
    const refName = (ref: string) => ref.slice(ref.indexOf(':') + 1)

    const item = () => refName(props.block.what)
    const targetName = () => {
        const id = refName(props.block.on)
        for (const a of Object.values(state.assets.actors ?? {})) {
            if (a.customId === id) return a.name
        }
        return id
    }

    return (
        <div class="chat-block chat-block-tryUse">
            <span class="chat-block-choice-text">
                {pickEmojiForItem(item())} Use <b>{item()}</b> on <b>{targetName()}</b>
            </span>
        </div>
    )
}
