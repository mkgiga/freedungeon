import { createMemo, For, Match, Switch } from 'solid-js'
import { MdFillMore_horiz } from 'solid-icons/md'
import type { ChatMessage as ChatMessageType } from '@shared/types'
import { parseBlocks, serializeBlocks, type Block } from './blocks'
import { trpc } from '../../trpc'
import { Dropdown } from '../Dropdown'
import { useModal } from '../Modal'
import { Text } from '../typography/Text'
import { Em } from '../typography/Em'
import { SpeechBlock } from './blocks/SpeechBlock'
import { TextBlock } from './blocks/TextBlock'
import { ImageBlock } from './blocks/ImageBlock'
import { PauseBlock } from './blocks/PauseBlock'
import { WebviewBlock } from './blocks/WebviewBlock'
import { UnformattedBlock } from './blocks/UnformattedBlock'
import { NoOpContinueBlock } from './blocks/NoOpContinueBlock'
import { DamageBlock } from './blocks/DamageBlock'
import { HealBlock } from './blocks/HealBlock'
import { GiveItemBlock } from './blocks/GiveItemBlock'
import { TakeItemBlock } from './blocks/TakeItemBlock'
import { SetLocationBlock } from './blocks/SetLocationBlock'
import { usePlayback } from './playback'

export function ChatMessage(props: { message: ChatMessageType }) {
    const blocks = createMemo(() => parseBlocks(props.message.content))
    const modal = useModal()
    const playback = usePlayback()

    // Whether a given block index is "in the future" of the current playback —
    // i.e., this message is the playing one AND the block hasn't been revealed
    // yet (`i >= cursor`). Future blocks still render to the DOM at their full
    // height; they just get `visibility: hidden` via .chat-block-future so
    // they reserve layout space without being painted. The result is a
    // stable, full-final-height layout for the playing message from the
    // moment it arrives — no reflow as the typewriter or cursor advances.
    const isFutureBlock = (i: number) =>
        props.message.id === playback.playingMessageId() && i >= playback.cursor()

    const isPlaying = () => props.message.id === playback.playingMessageId()

    /**
     * Message-level tap target. While this message is mid-playback, a tap
     * anywhere in the message routes to `playback.tap()` (skip-scroll if the
     * typewriter is still going, otherwise advance). Interactive descendants
     * keep their own behavior:
     *   - Past blocks' EditableText handles its own focus → editing.
     *   - Past speech avatars (enabled buttons) open the expression picker.
     *   - The chat-message-actions dropdown calls `e.stopPropagation()` on
     *     its trigger, so it never reaches this handler.
     *
     * The filter `button:not(:disabled), .editable-text` lets clicks on
     * interactive elements pass through unhandled, while everything else —
     * the locked text/dialogue area, whitespace, the speech-block name, the
     * disabled-while-active avatar — falls through to `tap()`.
     */
    const handleMessageClick = (e: MouseEvent) => {
        if (!isPlaying()) return
        const target = e.target as HTMLElement | null
        if (target?.closest('button:not(:disabled), input, textarea, select, .editable-text, a[href]')) return
        playback.tap()
    }

    const updateBlock = (index: number, updated: Block) => {
        const current = blocks()
        const newBlocks = current.map((b, i) => (i === index ? updated : b))
        const newContent = serializeBlocks(newBlocks)
        if (newContent === props.message.content) return
        trpc.chat.updateMessage.mutate({ id: props.message.id, content: newContent })
    }

    const confirmDelete = () => {
        modal.open({
            title: 'Delete Message',
            content: () => (
                <div>
                    <Text>Are you sure you want to delete this <Em type="danger" bold>message</Em>?</Text>
                    <div class="modal-confirm-actions">
                        <button class="modal-btn modal-btn-cancel" onClick={() => modal.close()}>Cancel</button>
                        <button
                            class="modal-btn modal-btn-confirm"
                            onClick={() => {
                                trpc.chat.deleteMessage.mutate({ id: props.message.id })
                                modal.close()
                            }}
                        >
                            Delete
                        </button>
                    </div>
                </div>
            ),
        })
    }

    return (
        <div
            class="chat-message"
            classList={{ 'chat-message-playing': isPlaying() }}
            onClick={handleMessageClick}
        >
            <div class="chat-message-actions">
                <Dropdown
                    trigger={<MdFillMore_horiz size={18} />}
                    items={[
                        { label: 'Regenerate', onClick: () => trpc.chat.regenerateMessage.mutate({ id: props.message.id }) },
                        { label: 'Rewind here', onClick: () => trpc.chat.rewindToMessage.mutate({ id: props.message.id }) },
                        { label: 'Branch from here', onClick: () => trpc.chat.branchFromMessage.mutate({ id: props.message.id }) },
                        { label: 'Delete', danger: true, onClick: confirmDelete },
                    ]}
                />
            </div>
            <For each={blocks()}>
                {(block, i) => (
                    <div classList={{ 'chat-block-future': isFutureBlock(i()) }}>
                        <Switch>
                            <Match when={block.type === 'speech'}>
                                <SpeechBlock
                                    block={block as Extract<Block, { type: 'speech' }>}
                                    onUpdate={(b) => updateBlock(i(), b)}
                                    isActive={playback.isActiveBlock(props.message.id, i())}
                                    onAdvance={() => playback.advance()}
                                />
                            </Match>
                            <Match when={block.type === 'text'}>
                                <TextBlock
                                    block={block as Extract<Block, { type: 'text' }>}
                                    onUpdate={(b) => updateBlock(i(), b)}
                                    isActive={playback.isActiveBlock(props.message.id, i())}
                                    onAdvance={() => playback.advance()}
                                />
                            </Match>
                            <Match when={block.type === 'image'}>
                                <ImageBlock
                                    block={block as Extract<Block, { type: 'image' }>}
                                    onUpdate={(b) => updateBlock(i(), b)}
                                />
                            </Match>
                            <Match when={block.type === 'pause'}>
                                <PauseBlock
                                    block={block as Extract<Block, { type: 'pause' }>}
                                    onUpdate={(b) => updateBlock(i(), b)}
                                    isActive={playback.isActiveBlock(props.message.id, i())}
                                />
                            </Match>
                            <Match when={block.type === 'webview'}>
                                <WebviewBlock
                                    block={block as Extract<Block, { type: 'webview' }>}
                                    onUpdate={(b) => updateBlock(i(), b)}
                                />
                            </Match>
                            <Match when={block.type === 'unformatted'}>
                                <UnformattedBlock
                                    block={block as Extract<Block, { type: 'unformatted' }>}
                                    onUpdate={(b) => updateBlock(i(), b)}
                                />
                            </Match>
                            <Match when={block.type === 'noOpContinue'}>
                                <NoOpContinueBlock
                                    block={block as Extract<Block, { type: 'noOpContinue' }>}
                                    onUpdate={(b) => updateBlock(i(), b)}
                                />
                            </Match>
                            <Match when={block.type === 'damage'}>
                                <DamageBlock
                                    block={block as Extract<Block, { type: 'damage' }>}
                                    onUpdate={(b) => updateBlock(i(), b)}
                                />
                            </Match>
                            <Match when={block.type === 'heal'}>
                                <HealBlock
                                    block={block as Extract<Block, { type: 'heal' }>}
                                    onUpdate={(b) => updateBlock(i(), b)}
                                />
                            </Match>
                            <Match when={block.type === 'giveItem'}>
                                <GiveItemBlock
                                    block={block as Extract<Block, { type: 'giveItem' }>}
                                    onUpdate={(b) => updateBlock(i(), b)}
                                />
                            </Match>
                            <Match when={block.type === 'takeItem'}>
                                <TakeItemBlock
                                    block={block as Extract<Block, { type: 'takeItem' }>}
                                    onUpdate={(b) => updateBlock(i(), b)}
                                />
                            </Match>
                            <Match when={block.type === 'setLocation'}>
                                <SetLocationBlock
                                    block={block as Extract<Block, { type: 'setLocation' }>}
                                    onUpdate={(b) => updateBlock(i(), b)}
                                />
                            </Match>
                        </Switch>
                    </div>
                )}
            </For>
        </div>
    )
}
