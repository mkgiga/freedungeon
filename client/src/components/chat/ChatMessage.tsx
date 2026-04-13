import { createMemo, For, Match, Switch } from 'solid-js'
import type { ChatMessage as ChatMessageType } from '@shared/types'
import { parseBlocks, serializeBlocks, type Block } from './blocks'
import { trpc } from '../../trpc'
import { SpeechBlock } from './blocks/SpeechBlock'
import { TextBlock } from './blocks/TextBlock'
import { ImageBlock } from './blocks/ImageBlock'
import { PauseBlock } from './blocks/PauseBlock'
import { WebviewBlock } from './blocks/WebviewBlock'
import { UnformattedBlock } from './blocks/UnformattedBlock'

export function ChatMessage(props: { message: ChatMessageType }) {
    const blocks = createMemo(() => parseBlocks(props.message.content))

    const updateBlock = (index: number, updated: Block) => {
        const current = blocks()
        const newBlocks = current.map((b, i) => (i === index ? updated : b))
        const newContent = serializeBlocks(newBlocks)
        if (newContent === props.message.content) return
        trpc.chat.updateMessage.mutate({ id: props.message.id, content: newContent })
    }

    return (
        <div class="chat-message">
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
                    </Switch>
                )}
            </For>
        </div>
    )
}
