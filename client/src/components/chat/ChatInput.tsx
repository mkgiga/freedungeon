import { createMemo, createSignal, Show } from 'solid-js'
import { state } from '../../state'
import { trpc } from '../../trpc'
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
} from 'solid-icons/md'
import { GameStateActorStatus } from '../GameStateActorStatus'
import { ChatHotbar } from './ChatHotbar'
import { InventoryModal } from './InventoryModal'

export function ChatInput() {
    const [message, setMessage] = createSignal('')
    const [textareaFocused, setTextareaFocused] = createSignal(false)
    const modal = useModal()

    const currentActor = createMemo(() => {
        const id = state.userPreferences.playerCharacterId
        if (id == null) return null
        return state.assets.actors?.[id] ?? null
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
            content: () => <InventoryModal />,
        })
    }

    const handleSend = async () => {
        const text = message().trim()
        if (!text) return
        setMessage('')
        await trpc.chat.prompt.mutate({ message: `unformatted(${JSON.stringify(text)});` })
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
    const handleRegenerate = () => {
        const id = latestMessageId()
        if (!id) return
        trpc.chat.regenerateMessage.mutate({ id })
    }

    const handleContinue = async () => {
        await trpc.chat.prompt.mutate({ message: `noOpContinue()` })
    }

    return (
        <div class="chat-input-container" classList={{
            'is-textarea-focused': textareaFocused(),
            // Empty message AND not generating → FAB would be a no-op on mobile.
            // We still want to show it during generation since it turns into Stop.
            'is-empty-message': !state.isGenerating && message().trim() === '',
        }}>
            <div class="chat-input-toolbar">
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
                            <GameStateActorStatus
                                customId={actor().customId}
                                hp={state.currentChat.gameState.scene.actors.active[actor().customId]?.hp}
                                variant="small"
                            />
                        </button>
                    )}
                </Show>
                <div class="chat-input-spacer" />
                <ChatHotbar />
                <button class="chat-input-btn" onClick={openInventory} title="Inventory">
                    <MdFillInventory_2 size={20} />
                </button>
                <button class="chat-input-btn" onClick={handleRegenerate} title="Regenerate">
                    <MdFillRefresh size={20} />
                </button>
                <button class="chat-input-btn" onClick={handleContinue} title="Fast forward">
                    <MdFillFast_forward size={20} />
                </button>
                <span>{/* empty element to give right padding the same size as the flex gap */}</span>
            </div>
            <div class="chat-input-row">
                <textarea
                    class="chat-input-textarea"
                    placeholder="Type a message..."
                    value={message()}
                    onInput={(e) => setMessage(e.currentTarget.value)}
                    onFocus={() => setTextareaFocused(true)}
                    onBlur={() => setTextareaFocused(false)}
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
