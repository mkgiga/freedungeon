import { createMemo, createSignal, Show } from 'solid-js'
import { state } from '../../state'
import { trpc } from '../../trpc'
import { ImageIcon } from '../ImageIcon'
import { Text } from '../typography/Text'
import {
    MdFillArrow_upward,
    MdFillRefresh,
    MdFillFast_forward,
    MdFillAuto_fix_high,
    MdFillSend,
    MdFillStop,
} from 'solid-icons/md'

export function ChatInput() {
    const [message, setMessage] = createSignal('')

    const currentActor = createMemo(() => {
        const id = state.userPreferences.playerCharacterId
        if (id == null) return null
        return state.assets.actors?.[id] ?? null
    })

    const handleSend = async () => {
        const text = message().trim()
        if (!text) return
        setMessage('')
        await trpc.chat.prompt.mutate({ message: text })
    }

    const handleStop = () => trpc.chat.cancel.mutate()

    const handleContinue = () => console.log('[ChatInput] continue')
    const handleRegenerate = () => console.log('[ChatInput] regenerate')
    const handleFastForward = () => console.log('[ChatInput] fast-forward')
    const handlePrompt = () => console.log('[ChatInput] prompt')

    return (
        <div class="chat-input-container">
            <div class="chat-input-toolbar">
                <button class="chat-input-btn" onClick={handleContinue} title="Continue">
                    <MdFillArrow_upward size={20} />
                </button>
                <button class="chat-input-btn" onClick={handleRegenerate} title="Regenerate">
                    <MdFillRefresh size={20} />
                </button>
                <button class="chat-input-btn" onClick={handleFastForward} title="Fast forward">
                    <MdFillFast_forward size={20} />
                </button>
                <button class="chat-input-btn" onClick={handlePrompt} title="Prompt">
                    <MdFillAuto_fix_high size={20} />
                </button>
                <div class="chat-input-spacer" />
                <Show when={currentActor()}>
                    {(actor) => (
                        <div class="chat-input-current-actor">
                            <Text size="sm">{actor().name}</Text>
                            <ImageIcon url={actor().avatarUrl} size={28} />
                        </div>
                    )}
                </Show>
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
        </div>
    )
}
