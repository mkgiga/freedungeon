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
import { Toolbar } from '../Toolbar'

export function ChatInput() {
    const [message, setMessage] = createSignal('')
    const modal = useModal()

    const currentActor = createMemo(() => {
        const id = state.userPreferences.playerCharacterId
        if (id == null) return null
        return state.assets.actors?.[id] ?? null
    })

    const playerHp = createMemo(() => {
        const actor = currentActor()
        if (!actor) return null
        return state.currentChat.gameState.scene.actors.active[actor.customId]?.hp ?? null
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
        <div class="chat-input-container relative">
            <Show when={state.currentChat.gameState.scene.actors.active[currentActor()?.customId ?? '']}>
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
                    </>
                )
            }} />

            <div class="chat-input-row">
                <textarea
                    class="chat-input-textarea"
                    placeholder="Type a message..."
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
