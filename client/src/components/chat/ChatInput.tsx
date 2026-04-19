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
} from 'solid-icons/md'
import { GameStateActorStatus } from '../GameStateActorStatus'

export function ChatInput() {
    const [message, setMessage] = createSignal('')
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
        <div class="chat-input-container">
            <div class="chat-input-toolbar">
                <button class="chat-input-btn" onClick={handleRegenerate} title="Regenerate">
                    <MdFillRefresh size={20} />
                </button>
                <button class="chat-input-btn" onClick={handleContinue} title="Fast forward">
                    <MdFillFast_forward size={20} />
                </button>
                <div class="chat-input-spacer" />
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
                <span>{/* empty element to give right padding the same size as the flex gap */}</span>
            </div>
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
