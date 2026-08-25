import { createMemo, createSignal, Show, type JSXElement } from 'solid-js'
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
    MdFillMore_horiz,
    MdFillBug_report,
} from 'solid-icons/md'
import { Em } from '../typography/Em'
import { AnchoredMenu, type DropdownItem } from '../Dropdown'
import { useDebugPrompt } from './DebugPrompt'
import { ContinueBar } from './ContinueBar'
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

/** Only drives the placeholder - the options render inline in the history. */
export function createPendingChoicePrompt() {
    const playback = usePlayback()
    return createMemo(() => {
        if (!featureEnabled(state.userPreferences, 'choicePrompts')) return null
        const id = latestMessageId()
        if (!id) return null
        if (!playback.isMessageRevealed(id)) return null
        const msg = state.currentChat.messages[id]
        if (!msg || msg.role !== 'assistant' || msg.metadata?.chosenIndex != null) return null
        const promptBlock = parseBlocks(msg.content).find(b => b.type === 'choicePrompt')
        if (!promptBlock || promptBlock.type !== 'choicePrompt') return null
        return { messageId: id, options: promptBlock.options }
    })
}

export function ChatInput(props: {
    hud?: JSXElement
}) {
    const [message, setMessage] = createSignal('')
    const modal = useModal()
    const playback = usePlayback()
    const openDebugPrompt = useDebugPrompt()
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
        if (blockedReason()) return
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

    useAction('chat.regenerate', () => { void handleRegenerate() })
    useAction('chat.fastForward', () => { void handleContinue() })

    let composerEl: HTMLTextAreaElement | undefined
    useAction('chat.send', () => { void handleSend() }, {
        whileTyping: true,
        enabled: () => viewport() !== 'phone'
            && !!composerEl
            && document.activeElement === composerEl,
    })

    const pendingChoicePrompt = createPendingChoicePrompt()

    const overflowItems = createMemo<DropdownItem[]>(() => {
        const items: DropdownItem[] = [{
            label: hasPendingNotice() ? "Director's note (pending)" : "Director's note",
            icon: <MdFillEdit_note size={18} />,
            onClick: openDirectorNote,
            title: hasPendingNotice()
                ? "Director's note pending — will attach to next turn"
                : 'A private note for your next turn',
        }]
        if (state.userPreferences.debug) {
            items.push({
                label: 'Inspect last prompt',
                icon: <MdFillBug_report size={18} />,
                onClick: openDebugPrompt,
                title: 'Inspect the prompt last sent to the provider',
            })
        }
        const rehydration = state.currentChat.agentRehydration
        if (rehydration) {
            items.push({
                label: 'Agent has no live session',
                icon: <MdFillWarning size={18} />,
                onClick: openRehydrationInfo,
                title: `Next turn will inject ${rehydration.messageCount} prior messages `
                    + `(~${rehydration.estimatedTokens.toLocaleString()} input tokens) to rebuild context.`,
            })
        }
        return items
    })

    const [menuOpen, setMenuOpen] = createSignal(false)
    let menuAnchor: HTMLButtonElement | undefined

    return (
        <div class="chat-composer">
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

            <div class="chat-composer-actions">
                <button
                    ref={menuAnchor}
                    class="chat-input-btn"
                    classList={{
                        'is-active-notice': hasPendingNotice(),
                        'text-emphasis-warning': !hasPendingNotice() && !!state.currentChat.agentRehydration,
                    }}
                    onClick={() => setMenuOpen(o => !o)}
                    title="More"
                >
                    <MdFillMore_horiz size={20} />
                </button>
                <Show when={menuOpen() && menuAnchor}>
                    {(anchor) => (
                        <AnchoredMenu
                            anchor={anchor()}
                            items={overflowItems()}
                            onClose={() => setMenuOpen(false)}
                        />
                    )}
                </Show>

                <div class="chat-composer-hud">{props.hud}</div>

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

            <Show
                when={!playback.hasUnread()}
                fallback={<ContinueBar />}
            >
                <textarea
                    class="chat-input-textarea"
                    disabled={!!blockedReason()}
                    placeholder={pendingChoicePrompt() ? '…or type your own action' : 'Type a message...'}
                    value={message()}
                    onInput={(e) => setMessage(e.currentTarget.value)}
                    ref={(el) => { composerEl = el }}
                />
            </Show>
        </div>
    )
}
