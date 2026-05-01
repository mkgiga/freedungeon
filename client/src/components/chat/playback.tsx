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
}

const PlaybackContext = createContext<PlaybackApi | null>(null)

export function usePlayback(): PlaybackApi {
    const v = useContext(PlaybackContext)
    if (!v) throw new Error('usePlayback() must be used inside <PlaybackProvider>')
    return v
}

const sortByCreatedAt = (a: ChatMessage, b: ChatMessage) =>
    (a.createdAt - b.createdAt) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)

export function PlaybackProvider(props: { children: JSX.Element }) {
    const [playingMessageId, setPlayingMessageId] = createSignal<string | null>(null)
    const [cursor, setCursor] = createSignal(0)

    /**
     * Assistant message ids we've already shown (or chosen to skip). On chat
     * load this is seeded with every existing assistant id so old messages
     * don't auto-play. Newly-arrived assistant ids land outside this set and
     * trigger playback exactly once.
     */
    const seenAssistantIds = new Set<string>()

    let pauseTimer: ReturnType<typeof setTimeout> | null = null

    const clearPauseTimer = () => {
        if (pauseTimer !== null) {
            clearTimeout(pauseTimer)
            pauseTimer = null
        }
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
            return
        }

        if (lastRevealed?.type === 'pause') {
            const ms = Math.max(0, lastRevealed.seconds * 1000)
            pauseTimer = setTimeout(() => {
                pauseTimer = null
                autoAdvance()
            }, ms)
        }
    }

    const advance = () => {
        if (untrack(playingMessageId) === null) return
        autoAdvance()
    }

    const skipAll = () => {
        clearPauseTimer()
        const id = untrack(playingMessageId)
        if (id === null) return
        const blocks = getPlayingBlocks()
        setCursor(blocks?.length ?? 0)
        setPlayingMessageId(null)
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

    onCleanup(() => clearPauseTimer())

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
    }

    return (
        <PlaybackContext.Provider value={api}>
            {props.children}
        </PlaybackContext.Provider>
    )
}
