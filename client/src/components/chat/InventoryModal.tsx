import { createMemo, For, Show } from 'solid-js'
import { state } from '../../state'
import { Text } from '../typography/Text'
import { pickEmojiForItem } from './inventory/itemEmoji'

export function InventoryModal() {
    const items = createMemo(() =>
        Object.entries(state.currentChat.gameState.inventory ?? {})
            .filter(([, qty]) => qty > 0)
            .sort(([a], [b]) => a.localeCompare(b))
    )

    return (
        <Show when={items().length > 0} fallback={<Text class="opacity-60 p-4">No items yet.</Text>}>
            <table class="inventory-table">
                <tbody>
                    <For each={items()}>{([name, qty]) => (
                        <tr class="inventory-row">
                            <td class="inventory-col-icon"><span>{pickEmojiForItem(name)}</span></td>
                            <td class="inventory-col-name"><Text size="base">{name}</Text></td>
                            <td class="inventory-col-qty"><Text size="base">{qty}</Text></td>
                        </tr>
                    )}</For>
                </tbody>
            </table>
        </Show>
    )
}
