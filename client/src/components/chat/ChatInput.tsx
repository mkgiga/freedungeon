import { createMemo, createSignal, For, Show } from 'solid-js'
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
} from 'solid-icons/md'
import { Em } from '../typography/Em'
import { DebugPromptButton } from './DebugPromptButton'
import { usePlayback } from './playback'

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

    const hasPendingNotice = createMemo(() =>
        (state.currentChat.pendingSystemNotice ?? '').trim().length > 0
    )

    /**
     * Run an action that triggers an agent turn. If this chat has no
     * SDK session yet, show a confirm modal with the estimated rebuild
     * cost first. Resolves true when the action ran, false when the
     * user cancelled.
     */
    const withRehydrationConfirm = (
        actionLabel: string,
        run: () => Promise<void> | void,
    ): Promise<boolean> => {
        const rehydration = state.currentChat.agentRehydration
        if (!rehydration) {
            const r = run()
            return Promise.resolve(r instanceof Promise ? r.then(() => true) : true) as Promise<boolean>
        }
        return new Promise<boolean>((resolve) => {
            modal.open({
                title: 'Rebuild agent memory?',
                content: () => (
                    <div>
                        <Text>
                            This chat has <Em bold>{rehydration.messageCount} prior messages</Em>{' '}
                            but no live agent session. The next agent turn will inject the full
                            chat history into a new session so the agent regains context.
                        </Text>
                        <Text class="mt-2">
                            <Em type="warning" bold>One-time cost:</Em> approximately{' '}
                            <Em bold>{rehydration.estimatedTokens.toLocaleString()} input tokens</Em>{' '}
                            (rough char/4 estimate). Subsequent prompts in this chat resume the
                            rebuilt session normally and hit cache.
                        </Text>
                        <div class="modal-confirm-actions">
                            <button class="modal-btn modal-btn-cancel" onClick={() => { modal.close(); resolve(false) }}>Cancel</button>
                            <button
                                class="modal-btn modal-btn-confirm"
                                onClick={async () => {
                                    modal.close()
                                    await run()
                                    resolve(true)
                                }}
                            >
                                {actionLabel}
                            </button>
                        </div>
                    </div>
                ),
            })
        })
    }

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

    const pendingChoicePrompt = createPendingChoicePrompt()

    const handleChoose = async (messageId: string, optionIndex: number) => {
        await withRehydrationConfirm('Choose anyway', () => {
            playback.skipAll()
            return trpc.chat.chooseOption.mutate({ messageId, optionIndex }).then(() => {})
        })
    }

    return (
        // Hidden rather than unmounted while the band shows the actors rail, so
        // an unsent draft survives closing and reopening the composer.
        <div class="chat-composer" classList={{ hidden: props.hidden }}>
            {/* Choice menu sits directly above the textarea so the two read as one
              * unit (no action strip wedged between them) when the latest agent
              * message is a menu. */}
            <Show when={pendingChoicePrompt()}>
                {(p) => (
                    <div class="choice-prompt-bar" role="group" aria-label="Choices">
                        <For each={p().options}>
                            {(option, i) => (
                                <button
                                    type="button"
                                    class="choice-prompt-option"
                                    disabled={state.isGenerating}
                                    onClick={() => handleChoose(p().messageId, i())}
                                >
                                    {option}
                                </button>
                            )}
                        </For>
                    </div>
                )}
            </Show>

            <textarea
                class="chat-input-textarea"
                placeholder={pendingChoicePrompt() ? '…or type your own action' : 'Type a message...'}
                value={message()}
                onInput={(e) => setMessage(e.currentTarget.value)}
                /*
                 * Enter sends, Shift+Enter breaks the line — the convention
                 * every desktop chat app uses. Ctrl/Cmd+Enter sends as well; it
                 * was the only send key before, and leaving it costs nothing.
                 *
                 * On a phone the on-screen keyboard's return key produces plain
                 * Enter with no modifier, so this makes it send there too. That
                 * matches the same apps, and the send button is still there for
                 * anyone who'd rather tap it.
                 */
                onKeyDown={(e) => {
                    if (e.key !== 'Enter') return
                    // Mid-IME, Enter commits the candidate rather than the
                    // message — sending here would fire on every accepted
                    // character for anyone typing Japanese, Chinese or Korean.
                    if (e.isComposing) return
                    if (e.shiftKey) return
                    e.preventDefault()
                    handleSend()
                }}
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
                            <button class="chat-input-btn chat-input-btn-send" onClick={handleSend} title="Send">
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
