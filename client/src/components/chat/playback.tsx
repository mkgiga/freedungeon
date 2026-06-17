import { createContext, createEffect, createMemo, createSignal, onCleanup, untrack, useContext, type JSX } from 'solid-js'
import type { ChatMessage, GameStateContext, SpeechTtsMeta } from '@shared/types'
import { applyBlockToCtx, runTurn } from '@shared/game-state'
import { parseBlocks, isBlockingBlock, type Block } from '@shared/blocks'
import { resolveFeatureConfig } from '@shared/features'
import { state } from '../../state'

type PlaybackApi = {
    /** Id of the message currently being played one block at a time, or null. */
    playingMessageId: () => string | null
    /** Number of blocks revealed so far in the playing message. The block at
     *  `cursor - 1` is the most recently revealed (and, if blocking, the one
     *  we're paused on). */
    cursor: () => number
    /** Advance past the currently-blocked-on block, then auto-advance until
     *  the next blocking block or end-of-message. */
    advance: () => void
    /** Reveal all remaining blocks instantly and end playback. Called silently
     *  when the user sends a follow-up while playback is active. */
    skipAll: () => void
    /** True iff this block is the currently-blocked-on block in active playback. */
    isActiveBlock: (messageId: string, blockIndex: number) => boolean
    /** Game state to render in the HUD. While playback is active, this is the
     *  ctx computed from history + revealed blocks of the playing message.
     *  Otherwise it's the server-authoritative `currentChat.gameState`. */
    effectiveGameState: () => GameStateContext
    /** Number of characters revealed in the active text/speech block's
     *  typewriter animation. Reset to 0 each time the active block changes. */
    activeRevealedCount: () => number
    /** True while the active block's typewriter is still revealing characters. */
    isActiveScrolling: () => boolean
    /** Single tap entry point: skip the active typewriter if it's still
     *  scrolling, otherwise advance to the next block. Called by the
     *  message-level click handler in ChatMessage. */
    tap: () => void
    /** True while the active speech block is held waiting for its TTS audio to
     *  finish generating. The block frame is shown; the dialogue is masked. */
    isAwaitingTts: () => boolean
}

const PlaybackContext = createContext<PlaybackApi | null>(null)

export function usePlayback(): PlaybackApi {
    const v = useContext(PlaybackContext)
    if (!v) throw new Error('usePlayback() must be used inside <PlaybackProvider>')
    return v
}

const sortByCreatedAt = (a: ChatMessage, b: ChatMessage) =>
    (a.createdAt - b.createdAt) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)

const TYPEWRITER_MS_PER_CHAR = 25

export function PlaybackProvider(props: { children: JSX.Element }) {
    const [playingMessageId, setPlayingMessageId] = createSignal<string | null>(null)
    const [cursor, setCursor] = createSignal(0)

    // Typewriter state for the active text/speech block. Lifted up here (vs.
    // local to each block) so the message-level click handler can drive both
    // skip-scroll and advance from a single entry point — the block itself no
    // longer owns timer or click logic. Reset to 0 / "" each time the active
    // block changes (see autoAdvance).
    const [activeRevealedCount, setActiveRevealedCount] = createSignal(0)
    const [activeTypewriterText, setActiveTypewriterText] = createSignal('')

    /**
     * Assistant message ids we've already shown (or chosen to skip). On chat
     * load this is seeded with every existing assistant id so old messages
     * don't auto-play. Newly-arrived assistant ids land outside this set and
     * trigger playback exactly once.
     */
    const seenAssistantIds = new Set<string>()

    // While a speech block's TTS audio is still generating we "hold" on it:
    // the block is revealed (frame visible) but the typewriter doesn't start
    // until the audio resolves (ready → play+typewriter, failed → typewriter
    // only). { id, index } identifies the held block; a resume effect watches
    // its tts status.
    const [holdingTts, setHoldingTts] = createSignal<{ id: string; index: number } | null>(null)

    let pauseTimer: ReturnType<typeof setTimeout> | null = null
    let typewriterTimer: ReturnType<typeof setInterval> | null = null
    let activeAudio: HTMLAudioElement | null = null

    const ttsEnabled = () => resolveFeatureConfig('tts', state.userPreferences.features?.tts).enabled

    const stopAudio = () => {
        if (activeAudio) {
            activeAudio.pause()
            activeAudio = null
        }
    }

    const playAudio = (url: string) => {
        stopAudio()
        activeAudio = new Audio(url)
        activeAudio.play().catch(() => { /* autoplay/format errors are non-fatal */ })
    }

    const clearPauseTimer = () => {
        if (pauseTimer !== null) {
            clearTimeout(pauseTimer)
            pauseTimer = null
        }
    }

    const stopTypewriter = () => {
        if (typewriterTimer !== null) {
            clearInterval(typewriterTimer)
            typewriterTimer = null
        }
    }

    const startTypewriter = (text: string) => {
        stopTypewriter()
        setActiveTypewriterText(text)
        setActiveRevealedCount(0)
        if (text.length === 0) return
        typewriterTimer = setInterval(() => {
            setActiveRevealedCount(c => {
                const next = c + 1
                if (next >= text.length) stopTypewriter()
                return next
            })
        }, TYPEWRITER_MS_PER_CHAR)
    }

    const isActiveScrolling = createMemo(() =>
        activeRevealedCount() < activeTypewriterText().length
    )

    /** Start a speech block's reveal: play its audio if ready, then typewriter. */
    const revealSpeech = (block: Extract<Block, { type: 'speech' }>, tts: SpeechTtsMeta | undefined) => {
        setHoldingTts(null)
        if (tts?.status === 'ready' && tts.audioUrl) playAudio(tts.audioUrl)
        else stopAudio()
        startTypewriter(block.dialogue)
    }

    const getPlayingBlocks = (): Block[] | null => {
        const id = untrack(playingMessageId)
        if (id === null) return null
        const msg = state.currentChat.messages[id]
        if (!msg) return null
        return parseBlocks(msg.content)
    }

    /**
     * Walk the cursor forward, stopping after revealing a blocking block. If
     * we land on a `pause`, schedule auto-advance after its duration. If we
     * run off the end, end playback.
     *
     * Cursor semantics: `cursor` is the count of revealed blocks. The block
     * at index `cursor - 1` is the most recently revealed. Calling this with
     * cursor=N walks through blocks[N], blocks[N+1], … advancing one at a
     * time and breaking after the first blocking one.
     */
    const autoAdvance = () => {
        clearPauseTimer()
        const blocks = getPlayingBlocks()
        if (!blocks) {
            setPlayingMessageId(null)
            stopTypewriter()
            return
        }

        let c = untrack(cursor)
        let lastRevealed: Block | undefined
        while (c < blocks.length) {
            lastRevealed = blocks[c]
            c++
            if (lastRevealed && isBlockingBlock(lastRevealed)) break
        }
        setCursor(c)

        if (c >= blocks.length) {
            setPlayingMessageId(null)
            stopTypewriter()
            stopAudio()
            return
        }

        // Configure per-blocking-type behavior for the new active block.
        if (lastRevealed?.type === 'text') {
            stopAudio()
            startTypewriter(lastRevealed.content)
        } else if (lastRevealed?.type === 'speech') {
            const id = untrack(playingMessageId)!
            const tts = state.currentChat.messages[id]?.metadata?.tts as SpeechTtsMeta | undefined
            // Hold while audio is still generating (pending, or not yet stamped
            // when the feature is on). The resume effect fires when it resolves.
            if (ttsEnabled() && tts?.status !== 'ready' && tts?.status !== 'failed') {
                stopTypewriter()
                stopAudio()
                setActiveTypewriterText('')
                setActiveRevealedCount(0)
                setHoldingTts({ id, index: c - 1 })
            } else {
                revealSpeech(lastRevealed, tts)
            }
        } else if (lastRevealed?.type === 'pause') {
            stopTypewriter()
            stopAudio()
            const ms = Math.max(0, lastRevealed.seconds * 1000)
            pauseTimer = setTimeout(() => {
                pauseTimer = null
                autoAdvance()
            }, ms)
        } else {
            stopTypewriter()
        }
    }

    const advance = () => {
        if (untrack(playingMessageId) === null) return
        autoAdvance()
    }

    const skipAll = () => {
        clearPauseTimer()
        stopTypewriter()
        stopAudio()
        setHoldingTts(null)
        const id = untrack(playingMessageId)
        if (id === null) return
        const blocks = getPlayingBlocks()
        setCursor(blocks?.length ?? 0)
        setPlayingMessageId(null)
    }

    /**
     * Single tap entry point. While the active typewriter is still scrolling,
     * tap snaps it to fully revealed (without advancing). Once revealed, tap
     * advances to the next block. Pause and other non-typewriter blocking
     * blocks have `isActiveScrolling() === false`, so tap on them advances
     * immediately — that's the right semantics: the user wants to skip the
     * pause if they tap during it.
     */
    const tap = () => {
        if (untrack(playingMessageId) === null) return
        // Held waiting for audio → reveal the line now (no audio) rather than wait.
        const hold = untrack(holdingTts)
        if (hold) {
            const blocks = getPlayingBlocks()
            const block = blocks?.[hold.index]
            if (block?.type === 'speech') revealSpeech(block as Extract<Block, { type: 'speech' }>, undefined)
            else setHoldingTts(null)
            return
        }
        if (untrack(isActiveScrolling)) {
            // First tap: full text + skip audio.
            stopTypewriter()
            setActiveRevealedCount(untrack(activeTypewriterText).length)
            stopAudio()
        } else {
            advance()
        }
    }

    // Combined effect: handles both chat-switch reseed and new-message
    // detection. Combined to avoid a race during chat load — `loadChat` on
    // the server replaces `currentChat` atomically, so id and messages both
    // change in the same batch. Splitting these into two effects could let
    // the messages-detection effect run first and treat freshly-loaded
    // history as "new," kicking off playback for an old message.
    //
    // Iteration of `state.currentChat.messages` MUST happen at the top of
    // the effect (in tracked scope, outside any `untrack`). Solid stores
    // only register a key-tracking subscription when an object is iterated
    // — reading the proxy reference alone doesn't subscribe to insertions.
    // If the iteration sat inside the reseed-branch's `untrack`, after a
    // chat switch this effect would have no subscription on key additions
    // and the next assistant message arriving in that chat would never
    // trigger playback.
    let lastSeenChatId: string | null = null
    createEffect(() => {
        const cid = state.currentChat.id
        const allMessages = Object.values(state.currentChat.messages)

        if (cid !== lastSeenChatId) {
            untrack(() => {
                skipAll()
                seenAssistantIds.clear()
                for (const m of allMessages) {
                    if (m.role === 'assistant') seenAssistantIds.add(m.id)
                }
            })
            lastSeenChatId = cid
            return
        }

        if (untrack(playingMessageId) !== null) return

        let candidate: ChatMessage | null = null
        for (const m of allMessages) {
            if (m.role !== 'assistant') continue
            if (seenAssistantIds.has(m.id)) continue
            if (!candidate || sortByCreatedAt(m, candidate) > 0) candidate = m
        }
        if (!candidate) return

        seenAssistantIds.add(candidate.id)
        setPlayingMessageId(candidate.id)
        setCursor(0)
        autoAdvance()
    })

    // Resume a held speech block once its TTS audio resolves (ready → audio +
    // typewriter, failed → typewriter only). Tracks holdingTts() and the held
    // message's tts status; the pipeline's patch flips it and re-runs this.
    createEffect(() => {
        const hold = holdingTts()
        if (!hold) return
        const tts = state.currentChat.messages[hold.id]?.metadata?.tts as SpeechTtsMeta | undefined
        if (tts?.status !== 'ready' && tts?.status !== 'failed') return
        untrack(() => {
            if (playingMessageId() !== hold.id || cursor() - 1 !== hold.index) {
                setHoldingTts(null)
                return
            }
            const blocks = getPlayingBlocks()
            const block = blocks?.[hold.index]
            if (block?.type === 'speech') revealSpeech(block, tts)
            else setHoldingTts(null)
        })
    })

    onCleanup(() => {
        clearPauseTimer()
        stopTypewriter()
        stopAudio()
    })

    /**
     * The playback-aware game state. Reruns shared `runTurn` over messages
     * strictly before the playing one, then applies blocks 0..cursor of the
     * playing message via `applyBlockToCtx`. When no playback is active it
     * just returns the server-authoritative ctx.
     */
    const localCtx = createMemo<GameStateContext | null>(() => {
        const playingId = playingMessageId()
        if (playingId === null) return null

        const messages = Object.values(state.currentChat.messages).sort(sortByCreatedAt)
        const idx = messages.findIndex(m => m.id === playingId)
        if (idx < 0) return null

        const before = messages.slice(0, idx)
        const { ctx } = runTurn(before)

        const playingMsg = messages[idx]!
        const blocks = parseBlocks(playingMsg.content)
        const c = cursor()
        const arr: string[] = []
        const limit = Math.min(c, blocks.length)
        for (let i = 0; i < limit; i++) {
            applyBlockToCtx(ctx, blocks[i]!, arr)
        }
        return ctx
    })

    const effectiveGameState = createMemo<GameStateContext>(() => {
        return localCtx() ?? state.currentChat.gameState
    })

    const isActiveBlock = (messageId: string, blockIndex: number): boolean => {
        return playingMessageId() === messageId && cursor() - 1 === blockIndex
    }

    const api: PlaybackApi = {
        playingMessageId,
        cursor,
        advance,
        skipAll,
        isActiveBlock,
        effectiveGameState,
        activeRevealedCount,
        isActiveScrolling,
        tap,
        isAwaitingTts: () => holdingTts() !== null,
    }

    return (
        <PlaybackContext.Provider value={api}>
            {props.children}
        </PlaybackContext.Provider>
    )
}
