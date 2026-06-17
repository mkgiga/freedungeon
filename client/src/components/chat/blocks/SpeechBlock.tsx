import { createMemo, Show } from 'solid-js'
import type { SpeechBlock as SpeechBlockType } from '../blocks'
import type { SpeechTtsMeta } from '@shared/types'
import { state } from '../../../state'
import { ImageIcon } from '../../ImageIcon'
import { useModal } from '../../Modal'
import { openExpressionPicker } from '../ExpressionPicker'
import { EditableText } from '../EditableText'
import { usePlayback } from '../playback'
import { currentDialogueUrl, toggleDialogue } from '../dialogueAudio'

export function SpeechBlock(props: {
    block: SpeechBlockType
    onUpdate: (block: SpeechBlockType) => void
    /** True only while this block is the currently-blocked-on block during
     *  playback. Reveal progress + tap routing are owned by the playback
     *  context — this component just renders what playback says is visible. */
    isActive?: boolean
    /** Kept for API compatibility; advance is now driven by the message-level
     *  click handler in ChatMessage via `playback.tap()`. */
    onAdvance?: () => void
    /** TTS state from the message metadata (when the voice feature is on). */
    tts?: SpeechTtsMeta
}) {
    const modal = useModal()
    const playback = usePlayback()

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

    const revealedCount = () => (props.isActive ? playback.activeRevealedCount() : props.block.dialogue.length)
    const isScrolling = () => props.isActive && playback.isActiveScrolling()
    // The voice is still synthesizing → the dialogue text isn't allowed to show
    // yet (block-level, independent of whether this is the actively-played
    // message). Cleared once TTS resolves to ready/failed.
    const ttsPending = () => props.tts?.status === 'pending'

    const isThisPlaying = () => !!props.tts?.audioUrl && currentDialogueUrl() === props.tts.audioUrl

    const toggleAudio = (e: MouseEvent) => {
        e.stopPropagation()
        if (props.tts?.audioUrl) toggleDialogue(props.tts.audioUrl)
    }

    const showPrompt = (e: MouseEvent) => {
        e.stopPropagation()
        modal.open({
            title: 'TTS prompt',
            content: () => (
                <div class="flex flex-col gap-2">
                    <Show when={props.tts?.error}>
                        <div class="text-emphasis-warning">Error: {props.tts!.error}</div>
                    </Show>
                    <pre class="chat-tts-prompt">{props.tts?.prompt ?? '(no prompt recorded)'}</pre>
                </div>
            ),
        })
    }

    return (
        <div class="chat-block chat-block-speech" classList={{ 'chat-block-active': props.isActive }}>
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
                <div class="chat-block-name">
                    {displayName()}
                    <Show when={props.tts?.status === 'ready' && props.tts.audioUrl}>
                        <button
                            class="chat-block-replay"
                            classList={{ 'is-playing': isThisPlaying() }}
                            title={isThisPlaying() ? 'Stop' : 'Play voice'}
                            onClick={toggleAudio}
                        >
                            {isThisPlaying() ? '⏹' : '▶'}
                        </button>
                    </Show>
                    <Show when={props.tts?.prompt || props.tts?.error}>
                        <button class="chat-block-replay" title="Show TTS prompt" onClick={showPrompt}>ⓘ</button>
                    </Show>
                </div>
                <Show
                    when={ttsPending()}
                    fallback={
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
                                {/* Pending dialogue rendered with `visibility: hidden`
                                 * so it contributes to layout (line wrapping + total
                                 * height) without being painted. The block sits at
                                 * its final size from character 0. */}
                                <span class="chat-block-dialogue-pending">
                                    {props.block.dialogue.slice(revealedCount())}
                                </span>
                                <Show when={!isScrolling()}>
                                    <span class="chat-block-tap-indicator">▶</span>
                                </Show>
                            </div>
                        </Show>
                    }
                >
                    {/* Voice still synthesizing — hold the text, show a placeholder. */}
                    <div class="chat-block-dialogue chat-block-dialogue-locked">
                        <span class="chat-block-tts-pending">🎙 generating voice…</span>
                    </div>
                </Show>
            </div>
        </div>
    )
}
