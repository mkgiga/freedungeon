import { createMemo, For, Match, Show, Switch } from 'solid-js'
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
import { UseItemBlock } from './blocks/UseItemBlock'
import { TryUseBlock } from './blocks/TryUseBlock'
import { SetLocationBlock } from './blocks/SetLocationBlock'
import { ChoicePromptBlock } from './blocks/ChoicePromptBlock'
import { ChoiceBlock } from './blocks/ChoiceBlock'
import { latestMessageId } from './latest'
import { featureEnabled } from '@shared/features'
import { state } from '../../state'
import { usePlayback } from './playback'
import { useRehydrationConfirm } from './rehydration'

/**
 * Block types with no renderer in the Switch below — pure state mutations that
 * leave nothing on screen. Anything asking "what did the reader last see?"
 * has to skip them. Keep in sync with the Switch.
 */
const SILENT_BLOCK_TYPES = new Set<Block['type']>([
    'enterActors', 'leaveActors', 'setHp', 'defineItem', 'setFlag', 'clearFlag',
])

export const isRenderedBlock = (block: Block) => !SILENT_BLOCK_TYPES.has(block.type)

/** The last block of `content` that actually renders, if any. */
export function lastRenderedBlock(content: string): Block | undefined {
    const blocks = parseBlocks(content)
    for (let i = blocks.length - 1; i >= 0; i--) {
        const b = blocks[i]
        if (b && isRenderedBlock(b)) return b
    }
    return undefined
}

export function ChatMessage(props: {
    message: ChatMessageType
    /**
     * Last rendered block of the preceding message, supplied by the feed —
     * agent turns emit one block per message, so a block's neighbour is
     * usually in another message entirely.
     */
    prevBlock?: Block
    /** Side a portrait image in this message aligns to — alternates down the feed. */
    portraitSide?: 'left' | 'right'
}) {
    const blocks = createMemo(() => parseBlocks(props.message.content))

    /**
     * The block the reader saw immediately before block `i`, skipping silent
     * ones and crossing the message boundary when needed. Deliberately keyed on
     * log order rather than playback reveal state: a layout that flipped as the
     * typewriter advanced would be worse than either arrangement.
     */
    const precedingRendered = (i: number): Block | undefined => {
        const bs = blocks()
        for (let k = i - 1; k >= 0; k--) {
            const b = bs[k]
            if (b && isRenderedBlock(b)) return b
        }
        return props.prevBlock
    }
    const modal = useModal()
    const playback = usePlayback()
    const withRehydrationConfirm = useRehydrationConfirm()

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

    // Choice prompts are interactive only while they're the latest message and
    // unanswered, and only when the global setting is on.
    const isLatest = () => latestMessageId() === props.message.id
    const choiceEnabled = () => featureEnabled(state.userPreferences, 'choicePrompts')
    const chosenIndex = () => props.message.metadata?.chosenIndex as number | undefined

    // A future assistant message that playback hasn't reached yet stays hidden,
    // so a fast provider can't show later dialogue/narration before the user
    // taps to it. User/system messages (and already-played ones) always show.
    const isVisible = () =>
        props.message.role !== 'assistant' || playback.isMessageRevealed(props.message.id)

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

    /**
     * Answering the menu is a turn trigger, exactly like pressing send — so it
     * takes the same two guards the composer applies: skip any unread playback
     * (the pick supersedes it) and confirm the rebuild cost if this chat has no
     * live agent session. Calling `chooseOption` bare would quietly skip both.
     */
    const chooseOption = async (optionIndex: number) => {
        if (state.isGenerating) return
        await withRehydrationConfirm('Choose anyway', () => {
            playback.skipAll()
            return trpc.chat.chooseOption
                .mutate({ messageId: props.message.id, optionIndex })
                .then(() => {})
        })
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
        <Show when={isVisible()}>
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
                    <div classList={{ 'chat-block-future': isFutureBlock(i()), 'block-container': true }}>
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
                                    prevBlock={precedingRendered(i())}
                                    portraitSide={props.portraitSide ?? 'left'}
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
                            <Match when={block.type === 'useItem'}>
                                <UseItemBlock
                                    block={block as Extract<Block, { type: 'useItem' }>}
                                    onUpdate={(b) => updateBlock(i(), b)}
                                />
                            </Match>
                            <Match when={block.type === 'tryUse'}>
                                <TryUseBlock
                                    block={block as Extract<Block, { type: 'tryUse' }>}
                                    onUpdate={(b) => updateBlock(i(), b)}
                                />
                            </Match>
                            <Match when={block.type === 'setLocation'}>
                                <SetLocationBlock
                                    block={block as Extract<Block, { type: 'setLocation' }>}
                                    onUpdate={(b) => updateBlock(i(), b)}
                                />
                            </Match>
                            <Match when={block.type === 'choicePrompt'}>
                                <ChoicePromptBlock
                                    block={block as Extract<Block, { type: 'choicePrompt' }>}
                                    chosenIndex={chosenIndex()}
                                    interactive={choiceEnabled() && isLatest() && chosenIndex() == null}
                                    onChoose={(index) => chooseOption(index)}
                                />
                            </Match>
                            <Match when={block.type === 'choice'}>
                                <ChoiceBlock
                                    block={block as Extract<Block, { type: 'choice' }>}
                                    onUpdate={(b) => updateBlock(i(), b)}
                                />
                            </Match>
                        </Switch>
                    </div>
                )}
            </For>
        </div>
        </Show>
    )
}
