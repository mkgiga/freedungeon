import { createContext, createEffect, createMemo, createSignal, onCleanup, untrack, useContext, type JSX } from 'solid-js'
import type { ChatMessage, GameStateContext } from '@shared/types'
import { applyBlockToCtx, runTurn } from '@shared/game-state'
import { parseBlocks, isBlockingBlock, type Block } from '@shared/blocks'
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
    /** Whether playback has reached (started) this assistant message yet.
     *  Future, not-yet-played messages return false so the UI can hide them. */
    isMessageRevealed: (id: string) => boolean
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
    // Reactive stamp over the (plain) seen set so components can gate rendering
    // on whether playback has reached a message yet.
    const [seenVersion, setSeenVersion] = createSignal(0)
    const markSeen = (id: string) => { seenAssistantIds.add(id); setSeenVersion(v => v + 1) }
    /**
     * A message is "revealed" once playback has started it (or it was seeded on
     * load). Future assistant messages playback hasn't reached are NOT revealed,
     * so the UI can hide them — a fast provider can't show later lines before
     * the user taps to them. (Non-assistant messages are always revealed; that
     * check lives in the consumer, which knows the role.)
     */
    const isMessageRevealed = (id: string) => { seenVersion(); return seenAssistantIds.has(id) }

    let pauseTimer: ReturnType<typeof setTimeout> | null = null
    let typewriterTimer: ReturnType<typeof setInterval> | null = null

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
            playNextUnseen()
            return
        }

        let c = untrack(cursor)
        let lastRevealed: Block | undefined
        let revealedBlocking = false
        while (c < blocks.length) {
            lastRevealed = blocks[c]
            c++
            if (lastRevealed && isBlockingBlock(lastRevealed)) { revealedBlocking = true; break }
        }
        setCursor(c)

        // Only end the message when we ran off the end WITHOUT hitting a
        // blocking block. If we broke on a blocking block we must stop and
        // configure it — even when it's the last block (the common case, since
        // each tool call is its own single-block message). Using `c >=
        // blocks.length` here was the bug: it also fired for a trailing blocking
        // block, so playback advanced instead of holding.
        if (!revealedBlocking) {
            setPlayingMessageId(null)
            stopTypewriter()
            playNextUnseen()
            return
        }

        // Configure per-blocking-type behavior for the new active block.
        if (lastRevealed?.type === 'text') {
            startTypewriter(lastRevealed.content)
        } else if (lastRevealed?.type === 'speech') {
            startTypewriter(lastRevealed.dialogue)
        } else if (lastRevealed?.type === 'pause') {
            stopTypewriter()
            const ms = Math.max(0, lastRevealed.seconds * 1000)
            pauseTimer = setTimeout(() => {
                pauseTimer = null
                autoAdvance()
            }, ms)
        } else {
            stopTypewriter()
        }
    }

    /**
     * Play the OLDEST not-yet-seen assistant message, if idle. Called when a
     * message arrives AND when the current one finishes, so a turn's messages
     * play strictly in order — nothing is skipped, and each blocking line
     * (text/speech/pause) waits for a tap before the next is revealed. This is
     * what keeps a fast provider from racing ahead of what the user has read
     * or heard. Callers invoke this outside any tracking scope.
     */
    const playNextUnseen = () => {
        if (untrack(playingMessageId) !== null) return
        let candidate: ChatMessage | null = null
        for (const m of Object.values(state.currentChat.messages)) {
            if (m.role !== 'assistant') continue
            if (seenAssistantIds.has(m.id)) continue
            if (!candidate || sortByCreatedAt(m, candidate) < 0) candidate = m
        }
        if (!candidate) return
        markSeen(candidate.id)
        setPlayingMessageId(candidate.id)
        setCursor(0)
        autoAdvance()
    }

    const advance = () => {
        if (untrack(playingMessageId) === null) return
        autoAdvance()
    }

    const skipAll = () => {
        clearPauseTimer()
        stopTypewriter()
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
        if (untrack(isActiveScrolling)) {
            // First tap: snap to full text.
            stopTypewriter()
            setActiveRevealedCount(untrack(activeTypewriterText).length)
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
                setSeenVersion(v => v + 1)
            })
            lastSeenChatId = cid
            return
        }

        // Iterating `allMessages` above subscribes this effect to new arrivals.
        // The actual selection/playback is untracked so reading message state
        // inside playNextUnseen doesn't add spurious dependencies.
        untrack(() => playNextUnseen())
    })

    onCleanup(() => {
        clearPauseTimer()
        stopTypewriter()
    })

    /**
     * The playback-aware game state. Replays history strictly before the
     * playing message, then applies blocks 0..cursor of the playing message
     * via `applyBlockToCtx`. When no playback is active it just returns the
     * server-authoritative ctx.
     *
     * The prefix replay is cached per playingMessageId and computed inside
     * `untrack`: the prefix is immutable while that message plays, and
     * without the cache every mid-turn message insertion (the agent emits
     * one message per block) re-replayed the entire history. The memo only
     * depends on `playingMessageId` and `cursor`.
     */
    let prefixCache: { playingId: string; ctx: GameStateContext } | null = null
    const localCtx = createMemo<GameStateContext | null>(() => {
        const playingId = playingMessageId()
        if (playingId === null) {
            prefixCache = null
            return null
        }

        if (prefixCache?.playingId !== playingId) {
            const prefixCtx = untrack(() => {
                const messages = Object.values(state.currentChat.messages).sort(sortByCreatedAt)
                const idx = messages.findIndex(m => m.id === playingId)
                if (idx < 0) return null
                return runTurn(messages.slice(0, idx)).ctx
            })
            if (!prefixCtx) return null
            prefixCache = { playingId, ctx: prefixCtx }
        }

        // Clone per run: applyBlockToCtx mutates, the cached prefix must stay
        // pristine, and downstream memos compare by reference.
        const ctx = structuredClone(prefixCache.ctx)
        const playingMsg = untrack(() => state.currentChat.messages[playingId])
        if (!playingMsg) return null
        const blocks = parseBlocks(playingMsg.content)
        const arr: string[] = []
        const limit = Math.min(cursor(), blocks.length)
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
        isMessageRevealed,
    }

    return (
        <PlaybackContext.Provider value={api}>
            {props.children}
        </PlaybackContext.Provider>
    )
}
