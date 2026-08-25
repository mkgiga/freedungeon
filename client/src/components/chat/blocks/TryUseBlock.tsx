import { Show } from 'solid-js'
import type { TryUseBlock as TryUseBlockType } from '../blocks'
import { state } from '../../../state'
import { pickEmojiForItem } from '../inventory/itemEmoji'
import { resolveItem } from '../inventory/resolveItem'

export function TryUseBlock(props: {
    block: TryUseBlockType
    onUpdate: (block: TryUseBlockType) => void
}) {
    const refName = (ref: string) => ref.slice(ref.indexOf(':') + 1)

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
