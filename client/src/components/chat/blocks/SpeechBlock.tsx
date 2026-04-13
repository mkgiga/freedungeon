import { createMemo } from 'solid-js'
import type { SpeechBlock as SpeechBlockType } from '../blocks'
import { state } from '../../../state'
import { ImageIcon } from '../../ImageIcon'
import { useModal } from '../../Modal'
import { openExpressionPicker } from '../ExpressionPicker'
import { EditableText } from '../EditableText'

export function SpeechBlock(props: {
    block: SpeechBlockType
    onUpdate: (block: SpeechBlockType) => void
}) {
    const modal = useModal()

    const actor = createMemo(() => {
        if (!props.block.actorId) return null
        return Object.values(state.assets.actors ?? {}).find(a => a.customId === props.block.actorId) ?? null
    })

    const displayName = createMemo(() => props.block.name ?? actor()?.name ?? props.block.actorId ?? 'Unknown')

    const avatarUrl = createMemo(() => {
        const a = actor()
        if (!a) return undefined
        if (props.block.expression && a.expressions?.[props.block.expression]) {
            return a.expressions[props.block.expression]
        }
        return a.avatarUrl || undefined
    })

    const initials = () => displayName().charAt(0)?.toUpperCase() ?? '?'

    const openPicker = () => {
        const a = actor()
        if (!a) return
        openExpressionPicker({
            modal,
            actor: a,
            current: props.block.expression,
            onPick: (expression) => {
                props.onUpdate({ ...props.block, expression })
            },
        })
    }

    return (
        <div class="chat-block chat-block-speech">
            <button
                class="chat-block-avatar"
                onClick={openPicker}
                disabled={!actor()}
                title={actor() ? 'Change expression' : undefined}
            >
                <ImageIcon
                    url={avatarUrl()}
                    size={40}
                    placeholder={<div class="chat-block-avatar-fallback">{initials()}</div>}
                />
            </button>
            <div class="chat-block-content">
                <div class="chat-block-name">{displayName()}</div>
                <EditableText
                    class="chat-block-dialogue"
                    initial={props.block.dialogue}
                    onCommit={(dialogue) => props.onUpdate({ ...props.block, dialogue })}
                />
            </div>
        </div>
    )
}
