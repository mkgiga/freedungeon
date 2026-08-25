import { createMemo } from 'solid-js'
import { MdFillSearch } from 'solid-icons/md'
import type { InspectBlock as InspectBlockType } from '../blocks'
import { state } from '../../../state'

/**
 * Stores the actor's customId so a rename still resolves. An unknown id renders
 * verbatim rather than blank, so a broken ref stays visible.
 */
export function InspectBlock(props: {
    block: InspectBlockType
    onUpdate: (block: InspectBlockType) => void
}) {
    const label = createMemo(() => {
        const id = props.block.target
        for (const actor of Object.values(state.assets.actors ?? {})) {
            if (actor.customId === id) return actor.name
        }
        return id
    })

    return (
        <div class="chat-block chat-block-inspect">
            <span class="inspect-label">
                <MdFillSearch class="inspect-icon" />
                Inspecting <span class="inspect-target">{label()}</span>
            </span>
        </div>
    )
}
