import { createContext, createEffect, createMemo, createSignal, onCleanup, untrack, useContext, type JSX } from 'solid-js'
import type { ChatMessage, GameStateContext } from '@shared/types'
import { applyBlockToCtx, runTurn } from '@shared/game-state'
import { parseBlocks, isBlockingBlock, type Block } from '@shared/blocks'
import { state } from '../../state'
import { resolveMentions } from './mentions'

type PlaybackApi = {
    playingMessageId: () => string | null
    cursor: () => number
    advance: () => void
    skipAll: () => void
    isActiveBlock: (messageId: string, blockIndex: number) => boolean
    effectiveGameState: () => GameStateContext
    activeRevealedCount: () => number
    isActiveScrolling: () => boolean
    tap: () => void
    isMessageRevealed: (id: string) => boolean
    hasUnread: () => boolean
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

    const [activeRevealedCount, setActiveRevealedCount] = createSignal(0)
    const [activeTypewriterText, setActiveTypewriterText] = createSignal('')

    const seenAssistantIds = new Set<string>()
    const [seenVersion, setSeenVersion] = createSignal(0)
    const markSeen = (id: string) => { seenAssistantIds.add(id); setSeenVersion(v => v + 1) }
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

    const autoSkip = () => state.userPreferences.interface?.chat?.autoSkip ?? false
    const holdsPlayback = (b: Block) => (autoSkip() ? b.type === 'pause' : isBlockingBlock(b))

    const getPlayingBlocks = (): Block[] | null => {
        const id = untrack(playingMessageId)
        if (id === null) return null
        const msg = state.currentChat.messages[id]
        if (!msg) return null
        return parseBlocks(msg.content)
    }

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
            if (lastRevealed && holdsPlayback(lastRevealed)) { revealedBlocking = true; break }
        }
        setCursor(c)

        if (!revealedBlocking) {
            setPlayingMessageId(null)
            stopTypewriter()
            playNextUnseen()
            return
        }

        if (lastRevealed?.type === 'text') {
            startTypewriter(resolveMentions(lastRevealed.content))
        } else if (lastRevealed?.type === 'speech') {
            startTypewriter(resolveMentions(lastRevealed.dialogue))
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

    const tap = () => {
        if (untrack(playingMessageId) === null) return
        if (untrack(isActiveScrolling)) {
            stopTypewriter()
            setActiveRevealedCount(untrack(activeTypewriterText).length)
        } else {
            advance()
        }
    }

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

        untrack(() => playNextUnseen())
    })

    onCleanup(() => {
        clearPauseTimer()
        stopTypewriter()
    })

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

    const hasUnread = () => playingMessageId() !== null && !autoSkip()

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
        hasUnread,
    }

    return (
        <PlaybackContext.Provider value={api}>
            {props.children}
        </PlaybackContext.Provider>
    )
}
