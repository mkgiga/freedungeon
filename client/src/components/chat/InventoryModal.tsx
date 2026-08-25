import { createMemo, For, Show } from 'solid-js'
import type { GameStateContext } from '@shared/types'
import { Text } from '../typography/Text'
import { pickEmojiForItem } from './inventory/itemEmoji'
import { resolveItem } from './inventory/resolveItem'
import { Loader } from '../Loader'
import { isIconPending } from './inventory/resolveItem'

export function InventoryModal(props: {
    gameState: () => GameStateContext
}) {
    const items = createMemo(() => {
        const ctx = props.gameState()
        return Object.entries(ctx.inventory ?? {})
            .filter(([, qty]) => qty > 0)
            .map(([key, qty]) => ({ ...resolveItem(ctx, key), qty }))
            .sort((a, b) => a.label.localeCompare(b.label))
    })

    return (
        <Show when={items().length > 0} fallback={<Text class="opacity-60 p-4">No items yet.</Text>}>
            <table class="inventory-table">
                <tbody>
                    <For each={items()}>{(item) => (
                        <tr class="inventory-row">
                            <td class="inventory-col-icon">
                                <Show
                                    when={item.icon}
                                    fallback={
                                        <Show when={isIconPending(item.key)} fallback={<span>{pickEmojiForItem(item.label)}</span>}>
                                            <Loader size={20} />
                                        </Show>
                                    }
                                >
                                    {(icon) => <img class="inventory-icon-img" src={icon()} alt={item.label} />}
                                </Show>
                            </td>
                            <td class="inventory-col-name">
                                <Text size="base">{item.label}</Text>
                                <Show when={item.description}>
                                    <Text size="sm" class="opacity-50">{item.description}</Text>
                                </Show>
                            </td>
                            <td class="inventory-col-qty"><Text size="base">{item.qty}</Text></td>
                        </tr>
                    )}</For>
                </tbody>
            </table>
        </Show>
    )
}
