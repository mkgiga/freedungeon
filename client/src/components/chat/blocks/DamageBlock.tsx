import { createMemo } from 'solid-js'
import { state } from '../../../state'
import type { DamageBlock as DamageBlockType } from '../blocks'

export function DamageBlock(props: {
    block: DamageBlockType
    onUpdate: (block: DamageBlockType) => void
}) {
    const actorName = createMemo(() => {
        const id = props.block.actorId
        const actor = Object.values(state.assets.actors ?? {}).find(a => a.customId === id)
        return actor?.name ?? id
    })

    return (
        <div class="chat-block chat-block-event chat-block-damage">
            <span class="chat-block-event-actor">{actorName()}</span>
            {' takes '}
            <span class="chat-block-event-amount">{props.block.amount}</span>
            {' damage.'}
        </div>
    )
}
