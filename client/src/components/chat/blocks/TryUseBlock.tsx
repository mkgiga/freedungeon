import { Show } from 'solid-js'
import type { TryUseBlock as TryUseBlockType } from '../blocks'
import { state } from '../../../state'
import { pickEmojiForItem } from '../inventory/itemEmoji'
import { resolveItem } from '../inventory/resolveItem'

/**
 * A drag-and-drop use attempt, rendered as a plain stated fact rather than a
 * chip. It used to borrow ChoiceBlock's pill, which framed it as something
 * offered or chosen from a set — but this is a thing the player already did,
 * and the agent's answering useItem / narration blocks carry what came of it.
 */
export function TryUseBlock(props: {
    block: TryUseBlockType
    onUpdate: (block: TryUseBlockType) => void
}) {
    // "item:Potion" / "actor:vega" — strip the kind prefix, keep the ref.
    const refName = (ref: string) => ref.slice(ref.indexOf(':') + 1)

    // The ref holds the item's definition key; show its label. Read from the
    // live gameState rather than a per-block snapshot — definitions persist for
    // the chat, so the current one is the right name for a historical block.
    const item = () => resolveItem(state.currentChat.gameState, refName(props.block.what))
    const targetName = () => {
        const id = refName(props.block.on)
        for (const a of Object.values(state.assets.actors ?? {})) {
            if (a.customId === id) return a.name
        }
        return id
    }

    return (
        <div class="chat-block chat-block-tryUse">
            <span class="tryuse-label">
                You used
                <Show
                    when={item().icon}
                    fallback={<span class="tryuse-emoji">{pickEmojiForItem(item().label)}</span>}
                >
                    {(icon) => <img class="tryuse-icon" src={icon()} alt="" />}
                </Show>
                <span class="tryuse-item">{item().label}</span>
                on {targetName()}.
            </span>
        </div>
    )
}
