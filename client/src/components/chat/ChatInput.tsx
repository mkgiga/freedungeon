import { createMemo, createSignal, Show } from 'solid-js'
import { state } from '../../state'
import { trpc } from '../../trpc'
import { parseBlocks } from './blocks'
import { featureEnabled } from '@shared/features'
import { Text } from '../typography/Text'
import { useModal } from '../Modal'
import {
    MdFillRefresh,
    MdFillFast_forward,
    MdFillSend,
    MdFillStop,
    MdFillWarning,
    MdFillEdit_note,
    MdFillDownload,
} from 'solid-icons/md'
import { Em } from '../typography/Em'
import { DebugPromptButton } from './DebugPromptButton'
import { usePlayback } from './playback'
import { useRehydrationConfirm } from './rehydration'
import { viewport } from '../../viewport'
import { useAction } from '../../actions'
import { turnBlockers } from '@shared/dependencies'

const latestMessageId = () => {
    const msgs = Object.values(state.currentChat.messages ?? {})
    if (msgs.length === 0) return null
    const latest = msgs.reduce((a, b) =>
        (a.createdAt - b.createdAt) > 0 ? a
            : (a.createdAt - b.createdAt) < 0 ? b
                : (a.id > b.id ? a : b)
    )
    return latest.id
}

/**
 * The latest message, if it's an unanswered choice menu and the setting is on.
 * Its options surface as buttons in the composer, beside the always-available
 * text field (the "type your own action" escape hatch). GameStatePanel uses the
 * same memo to flip itself into composer mode when a menu appears.
 */
export function createPendingChoicePrompt() {
    const playback = usePlayback()
    return createMemo(() => {
        if (!featureEnabled(state.userPreferences, 'choicePrompts')) return null
        const id = latestMessageId()
        if (!id) return null
        // Don't offer the menu until playback has actually reached this prompt —
        // otherwise the options appear in the input bar while earlier dialogue
        // is still typewriting/holding.
        if (!playback.isMessageRevealed(id)) return null
        const msg = state.currentChat.messages[id]
        if (!msg || msg.role !== 'assistant' || msg.metadata?.chosenIndex != null) return null
        const promptBlock = parseBlocks(msg.content).find(b => b.type === 'choicePrompt')
        if (!promptBlock || promptBlock.type !== 'choicePrompt') return null
        return { messageId: id, options: promptBlock.options }
    })
}

export function ChatInput(props: { hidden?: boolean }) {
    const [message, setMessage] = createSignal('')
    const modal = useModal()
    const playback = usePlayback()
    const withRehydrationConfirm = useRehydrationConfirm()

    const openDirectorNote = () => {
        const initial = state.currentChat.pendingSystemNotice ?? ''
        const [draft, setDraft] = createSignal(initial)
        modal.open({
            title: "Director's note",
            content: () => (
                <div class="flex flex-col gap-3">
                    <Text size="sm" class="opacity-70">
                        A private note for your next turn. Never spoken or acknowledged.
                        Cleared once sent.
                    </Text>
                    <textarea
                        class="text-editor-textarea"
                        style={{ "min-height": "12rem" }}
                        autofocus
                        placeholder="e.g. 100% increased chance to fail."
                        value={draft()}
                        onInput={(e) => setDraft(e.currentTarget.value)}
                    />
                    <div class="modal-confirm-actions">
                        <button class="modal-btn modal-btn-cancel" onClick={() => modal.close()}>Cancel</button>
                        <button
                            class="modal-btn modal-btn-confirm"
                            onClick={async () => {
                                await trpc.chat.setPendingSystemNotice.mutate({ text: draft() })
                                modal.close()
                            }}
                        >
                            Save
                        </button>
                    </div>
                </div>
            ),
        })
    }

    /**
     * Files an enabled feature is still waiting on.
     *
     * The same `turnBlockers` the server refuses prompts with, run against the
     * same replicated state — so the composer cannot claim a turn is possible
     * when the server would reject it, and the two can't drift as dependencies
     * are added.
     */
    const blockers = createMemo(() =>
        turnBlockers(state.dependencies, state.userPreferences.features))

    const blockedReason = createMemo(() => {
        const list = blockers()
        if (list.length === 0) return null
        const pct = (d: typeof list[number]) =>
            d.total && d.received ? ` ${Math.round((d.received / d.total) * 100)}%` : ''
        return `Downloading ${list.map(d => d.label + pct(d)).join(', ')}`
    })

    const hasPendingNotice = createMemo(() =>
        (state.currentChat.pendingSystemNotice ?? '').trim().length > 0
    )

    const openRehydrationInfo = () => {
        const rehydration = state.currentChat.agentRehydration
        if (!rehydration) return
        modal.open({
            title: 'Agent has no live session',
            content: () => (
                <div>
                    <Text>
                        This chat has <Em bold>{rehydration.messageCount} prior messages</Em> on
                        disk but no SDK session — either it was started before the agent system
                        existed, was branched/cloned from a chat without one, or its session
                        file is missing.
                    </Text>
                    <Text class="mt-2">
                        Your next agent turn (send, regenerate, or fast-forward) will inject
                        the full history as a context preamble — approximately{' '}
                        <Em bold>{rehydration.estimatedTokens.toLocaleString()} input tokens</Em>.
                        After that, the new session is saved and subsequent prompts resume
                        normally.
                    </Text>
                    <div class="modal-confirm-actions">
                        <button class="modal-btn modal-btn-cancel" onClick={() => modal.close()}>OK</button>
                    </div>
                </div>
            ),
        })
    }

    const sendNow = async (text: string) => {
        setMessage('')
        playback.skipAll()
        await trpc.chat.prompt.mutate({ message: `unformatted(${JSON.stringify(text)});` })
    }

    const handleSend = async () => {
        const text = message().trim()
        if (!text) return
        // Refused server-side too; stopping here keeps the draft rather than
        // clearing it into a rejected request.
        if (blockedReason()) return
        // The send button is a Stop button while generating, but Ctrl+Enter
        // still reaches here — and with auto-skip on, the composer is live
        // throughout a turn instead of being replaced by the continue bar.
        // `chat.prompt` rejects a concurrent turn server-side; don't call it.
        if (state.isGenerating) return
        await withRehydrationConfirm('Send anyway', () => sendNow(text))
    }

    const handleStop = () => trpc.chat.cancel.mutate()

    const handleRegenerate = async () => {
        const id = latestMessageId()
        if (!id) return
        await withRehydrationConfirm('Regenerate anyway', () => {
            playback.skipAll()
            return trpc.chat.regenerateMessage.mutate({ id }).then(() => {})
        })
    }

    const handleContinue = async () => {
        await withRehydrationConfirm('Continue anyway', () => {
            playback.skipAll()
            return trpc.chat.prompt.mutate({ message: `noOpContinue()` }).then(() => {})
        })
    }

    // Claimed while the composer exists, which is the only time they mean
    // anything. Both route through the same guards as the buttons.
    useAction('chat.regenerate', () => { void handleRegenerate() })
    useAction('chat.fastForward', () => { void handleContinue() })

    /*
     * Send is bound to a bare Enter, so it needs both escapes from the "don't
     * fire while typing" rule: `whileTyping` to be considered at all, and an
     * `enabled` that narrows it to THIS textarea. Without the second, Enter in
     * the rename dialog — or any other input in the app — would send a message,
     * because the composer is still mounted behind it.
     *
     * Desktop only: a phone's return key is a bare Enter with no Shift to reach
     * for, so binding it would leave no way to type a second line.
     */
    let composerEl: HTMLTextAreaElement | undefined
    useAction('chat.send', () => { void handleSend() }, {
        whileTyping: true,
        enabled: () => viewport() !== 'phone'
            && !!composerEl
            && document.activeElement === composerEl,
    })

    // Only for the placeholder hint. The options themselves render inline in
    // the history now — see ChoicePromptBlock — because a menu of any length
    // made this rail as tall as the answers, and there is no vertical room for
    // that. The composer stays the escape hatch for typing your own action.
    const pendingChoicePrompt = createPendingChoicePrompt()

    return (
        // Hidden rather than unmounted while the band shows the actors rail, so
        // an unsent draft survives closing and reopening the composer.
        <div class="chat-composer" classList={{ hidden: props.hidden }}>
            {/* Sits above the field rather than replacing it, so a half-typed
                message survives the wait. */}
            <Show when={blockedReason()}>
                {(reason) => (
                    <div class="chat-composer-blocked">
                        <MdFillDownload size={16} />
                        <Text size="sm">
                            {reason()} — a turn would fail without these. Turn image
                            generation off in Preferences to play now.
                        </Text>
                    </div>
                )}
            </Show>

            <textarea
                class="chat-input-textarea"
                disabled={!!blockedReason()}
                placeholder={pendingChoicePrompt() ? '…or type your own action' : 'Type a message...'}
                value={message()}
                onInput={(e) => setMessage(e.currentTarget.value)}
                ref={(el) => { composerEl = el }}
            />

            {/* Turn actions along the bottom edge: out-of-character tools on the
              * left, the ones that actually drive a turn on the right. Each side
              * is its own group so the row's justify-content can't put space
              * between neighbouring buttons. */}
            <div class="chat-composer-actions">
                <div class="chat-composer-actions-group">
                    <button
                        class="chat-input-btn"
                        classList={{ 'is-active-notice': hasPendingNotice() }}
                        onClick={openDirectorNote}
                        title={hasPendingNotice()
                            ? "Director's note pending — will attach to next turn"
                            : "Director's note for next turn"}
                    >
                        <MdFillEdit_note size={20} />
                    </button>
                    <Show when={state.userPreferences.debug}>
                        <DebugPromptButton />
                    </Show>
                    <Show when={state.currentChat.agentRehydration}>
                        {(r) => (
                            <button
                                class="chat-input-btn text-emphasis-warning"
                                title={`Agent has no live session — next turn will inject ${r().messageCount} prior messages (~${r().estimatedTokens.toLocaleString()} input tokens) to rebuild context. Click for details.`}
                                onClick={openRehydrationInfo}
                            >
                                <MdFillWarning size={20} />
                            </button>
                        )}
                    </Show>
                </div>

                <div class="chat-composer-actions-group">
                    <button class="chat-input-btn" onClick={handleContinue} title="Fast forward">
                        <MdFillFast_forward size={20} />
                    </button>
                    <button class="chat-input-btn" onClick={handleRegenerate} title="Regenerate">
                        <MdFillRefresh size={20} />
                    </button>
                    <Show
                        when={state.isGenerating}
                        fallback={
                            <button class="chat-input-btn chat-input-btn-send" onClick={handleSend} disabled={!!blockedReason()} title="Send">
                                <MdFillSend size={20} />
                            </button>
                        }
                    >
                        <button class="chat-input-btn chat-input-btn-send" onClick={handleStop} title="Stop">
                            <MdFillStop size={20} />
                        </button>
                    </Show>
                </div>
            </div>
        </div>
    )
}
