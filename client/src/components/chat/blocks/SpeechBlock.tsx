import { createEffect, createMemo, createSignal, on, onCleanup, Show } from 'solid-js'
import type { SpeechBlock as SpeechBlockType } from '../blocks'
import { state } from '../../../state'
import { ImageIcon } from '../../ImageIcon'
import { useModal } from '../../Modal'
import { openExpressionPicker } from '../ExpressionPicker'
import { EditableText } from '../EditableText'

const TYPEWRITER_MS_PER_CHAR = 25

export function SpeechBlock(props: {
    block: SpeechBlockType
    onUpdate: (block: SpeechBlockType) => void
    /** True only while this block is the currently-blocked-on block during
     *  playback. Drives the typewriter reveal of the dialogue and locks the
     *  avatar/EditableText so taps act as playback controls. */
    isActive?: boolean
    /** Called when the user taps an active, fully-revealed block. */
    onAdvance?: () => void
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

    const [revealedCount, setRevealedCount] = createSignal(0)

    // Reset and run the typewriter every time isActive flips true. Same shape
    // as TextBlock — local UI animation state, only meaningful while active.
    createEffect(on(() => props.isActive, (active) => {
        if (!active) return
        const text = props.block.dialogue
        setRevealedCount(0)
        if (text.length === 0) return
        const timer = setInterval(() => {
            setRevealedCount(c => {
                const next = c + 1
                if (next >= text.length) clearInterval(timer)
                return next
            })
        }, TYPEWRITER_MS_PER_CHAR)
        onCleanup(() => clearInterval(timer))
    }))

    const isScrolling = () => props.isActive && revealedCount() < props.block.dialogue.length

    const handleClick = () => {
        if (!props.isActive) return
        if (isScrolling()) {
            setRevealedCount(props.block.dialogue.length)
        } else {
            props.onAdvance?.()
        }
    }

    return (
        <div
            class="chat-block chat-block-speech"
            classList={{ 'chat-block-active': props.isActive }}
            onClick={handleClick}
        >
            <button
                class="chat-block-avatar"
                onClick={openPicker}
                disabled={!actor() || props.isActive}
                title={actor() && !props.isActive ? 'Change expression' : undefined}
            >
                <ImageIcon
                    url={avatarUrl()}
                    size={40}
                    placeholder={<div class="chat-block-avatar-fallback">{initials()}</div>}
                />
            </button>
            <div class="chat-block-content">
                <div class="chat-block-name">{displayName()}</div>
                <Show
                    when={props.isActive}
                    fallback={
                        <EditableText
                            class="chat-block-dialogue"
                            initial={props.block.dialogue}
                            onCommit={(dialogue) => props.onUpdate({ ...props.block, dialogue })}
                        />
                    }
                >
                    <div class="chat-block-dialogue chat-block-dialogue-locked">
                        {props.block.dialogue.slice(0, revealedCount())}
                        <Show when={!isScrolling()}>
                            <span class="chat-block-tap-indicator">▶</span>
                        </Show>
                    </div>
                </Show>
            </div>
        </div>
    )
}
