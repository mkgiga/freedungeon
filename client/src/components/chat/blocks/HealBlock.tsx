import { createMemo } from 'solid-js'
import { state } from '../../../state'
import { Text } from '../../typography/Text'
import type { HealBlock as HealBlockType } from '../blocks'

export function HealBlock(props: {
    block: HealBlockType
    onUpdate: (block: HealBlockType) => void
}) {
    const actorName = createMemo(() => {
        const id = props.block.actorId
        const actor = Object.values(state.assets.actors ?? {}).find(a => a.customId === id)
        return actor?.name ?? id
    })

    return (
        <Text size="base" class="chat-block chat-block-event chat-block-heal">
            <span class="chat-block-event-actor">{actorName()}</span>
            {' recovers '}
            <span class="chat-block-event-amount">{props.block.amount}</span>
            {' health.'}
        </Text>
    )
}
