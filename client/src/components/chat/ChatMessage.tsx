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

export function ChatMessage(props: { message: ChatMessageType }) {
    const blocks = createMemo(() => parseBlocks(props.message.content))
    const modal = useModal()

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
        <div class="chat-message">
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
                    <Switch>
                        <Match when={block.type === 'speech'}>
                            <SpeechBlock
                                block={block as Extract<Block, { type: 'speech' }>}
                                onUpdate={(b) => updateBlock(i(), b)}
                            />
                        </Match>
                        <Match when={block.type === 'text'}>
                            <TextBlock
                                block={block as Extract<Block, { type: 'text' }>}
                                onUpdate={(b) => updateBlock(i(), b)}
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
                    </Switch>
                )}
            </For>
        </div>
    )
}
