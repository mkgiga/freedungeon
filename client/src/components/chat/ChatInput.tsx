import { createMemo, createSignal, For, Show } from 'solid-js'
import { state } from '../../state'
import { trpc } from '../../trpc'
import { parseBlocks } from './blocks'
import { featureEnabled } from '@shared/features'
import { ImageIcon } from '../ImageIcon'
import { Text } from '../typography/Text'
import { useModal } from '../Modal'
import { PlayerCharacterPicker } from './AssetPicker'
import {
    MdFillArrow_upward,
    MdFillRefresh,
    MdFillFast_forward,
    MdFillAuto_fix_high,
    MdFillSend,
    MdFillStop,
    MdFillPerson,
    MdFillInventory_2,
    MdFillWarning,
    MdFillEdit_note,
} from 'solid-icons/md'
import { Em } from '../typography/Em'
import { GameStateActorStatus } from '../GameStateActorStatus'
import { ChatHotbar } from './ChatHotbar'
import { InventoryModal } from './InventoryModal'
import { Toolbar } from '../Toolbar'
import { usePlayback } from './playback'

export function ChatInput() {
    const [message, setMessage] = createSignal('')
    const modal = useModal()
    const playback = usePlayback()

    const currentActor = createMemo(() => {
        const id = state.userPreferences.playerCharacterId
        if (id == null) return null
        return state.assets.actors?.[id] ?? null
    })

    const playerHp = createMemo(() => {
        const actor = currentActor()
        if (!actor) return null
        return playback.effectiveGameState().scene.actors.active[actor.customId]?.hp ?? null
    })

    // Mirrors GameStateActorStatus's percentage math — default max is 100 since
    // per-actor max HP isn't tracked in the game state today.
    const hpPct = createMemo(() => {
        const hp = playerHp()
        if (hp == null) return 0
        return Math.max(0, Math.min(100, (hp / 100) * 100))
    })

    const openPlayerCharacterPicker = () => {
        modal.open({
            title: 'Player Character',
            content: () => <PlayerCharacterPicker onPick={() => modal.close()} />,
        })
    }

    const openInventory = () => {
        modal.open({
            title: 'Inventory',
            content: () => <InventoryModal gameState={() => playback.effectiveGameState()} />,
        })
    }

    const openDirectorNote = () => {
        const initial = state.currentChat.pendingSystemNotice ?? ''
        const [draft, setDraft] = createSignal(initial)
        modal.open({
            title: "Director's note",
            content: () => (
                <div class="flex flex-col gap-3">
                    <Text size="sm" class="opacity-70">
                        Attached to the next agent turn as a system notice — not framed as
                        your dialogue. Use to nudge or correct the agent out-of-character;
                        it will not be spoken or acknowledged in output. Cleared after the
                        next prompt is sent.
                    </Text>
                    <textarea
                        class="text-editor-textarea"
                        style={{ "min-height": "12rem" }}
                        autofocus
                        placeholder="e.g. Stop having Vega apologize after every line. Keep her terse."
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
        await withRehydrationConfirm('Send anyway', () => sendNow(text))
    }

    const handleStop = () => trpc.chat.cancel.mutate()

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

    // The latest message, if it's an unanswered choice menu and the setting is
    // on. Its options surface as buttons here, beside the always-available
    // text field (the "type your own action" escape hatch).
    const pendingChoicePrompt = createMemo(() => {
        if (!featureEnabled(state.userPreferences, 'choicePrompts')) return null
        const id = latestMessageId()
        if (!id) return null
        const msg = state.currentChat.messages[id]
        if (!msg || msg.role !== 'assistant' || msg.metadata?.chosenIndex != null) return null
        const promptBlock = parseBlocks(msg.content).find(b => b.type === 'choicePrompt')
        if (!promptBlock || promptBlock.type !== 'choicePrompt') return null
        return { messageId: id, options: promptBlock.options }
    })

    const handleChoose = async (messageId: string, optionIndex: number) => {
        await withRehydrationConfirm('Choose anyway', () => {
            playback.skipAll()
            return trpc.chat.chooseOption.mutate({ messageId, optionIndex }).then(() => {})
        })
    }

    return (
        <div class="chat-input-container relative">
            <Show when={playback.effectiveGameState().scene.actors.active[currentActor()?.customId ?? '']}>
                <div class="hp-bar" style={{ position: 'absolute', top: "-12px", left: 0, right: 0, height: '12px' }}>
                    <div class="hp-bar-fill relative" style={{ width: `${hpPct()}%`, height: '100%' }} />
                    <Text shadow='sm' size="sm" class="hp-bar-text absolute inset-0 flex items-center justify-center pointer-events-none">
                        {playerHp() ?? 'N/A'}
                    </Text>
                </div>
            </Show>
            <Toolbar class="chat-input-toolbar" slots={{
                left: (
                    <Show
                        when={currentActor()}
                        fallback={
                            <button
                                type="button"
                                class="chat-input-btn"
                                onClick={openPlayerCharacterPicker}
                                title="Set player character"
                            >
                                <MdFillPerson size={20} />
                            </button>
                        }
                    >
                        {(actor) => (
                            <button
                                type="button"
                                class="chat-input-current-actor"
                                onClick={openPlayerCharacterPicker}
                                title="Change player character"
                            >
                                <ImageIcon url={actor().avatarUrl} size={64} />
                            </button>
                        )}
                    </Show>
                ),
                right: (
                    <>
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
                        <ChatHotbar />
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
                        <button class="chat-input-btn" onClick={openInventory} title="Inventory">
                            <MdFillInventory_2 size={20} />
                        </button>
                        <button class="chat-input-btn" onClick={handleRegenerate} title="Regenerate">
                            <MdFillRefresh size={20} />
                        </button>
                        <button class="chat-input-btn" onClick={handleContinue} title="Fast forward">
                            <MdFillFast_forward size={20} />
                        </button>
                    </>
                )
            }} />

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

            <div class="chat-input-row">
                <textarea
                    class="chat-input-textarea"
                    placeholder={pendingChoicePrompt() ? '…or type your own action' : 'Type a message...'}
                    value={message()}
                    onInput={(e) => setMessage(e.currentTarget.value)}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                            e.preventDefault()
                            handleSend()
                        }
                    }}
                />
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
    )
}
