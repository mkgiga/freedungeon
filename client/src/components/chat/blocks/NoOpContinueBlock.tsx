import { MdFillFast_forward } from 'solid-icons/md'
import type { NoOpContinueBlock as NoOpContinueBlockType } from '../blocks'

export function NoOpContinueBlock(_props: {
    block: NoOpContinueBlockType
    onUpdate: (block: NoOpContinueBlockType) => void
}) {
    return (
        <div class="chat-block chat-block-continue" role="separator">
            <span class="chat-block-continue-line" />
            <span class="chat-block-continue-label">
                <MdFillFast_forward size={14} />
                AUTOCONTINUE
            </span>
            <span class="chat-block-continue-line" />
        </div>
    )
}
