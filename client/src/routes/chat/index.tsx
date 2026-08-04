import { createFileRoute, useNavigate } from '@tanstack/solid-router'
import { state } from '../../state'
import { trpc } from '../../trpc'
import { TopBar } from '../../components/TopBar'
import { createEffect, createMemo, createSignal, For, onMount, Show, untrack } from 'solid-js'
import { createViewportObserver } from '@solid-primitives/intersection-observer'
import { MdFillAdd, MdFillView_sidebar } from 'solid-icons/md'
import { Text } from '../../components/typography/Text'
import { ChatMessage, lastRenderedBlock } from '../../components/chat/ChatMessage'
import { parseBlocks, type Block } from '../../components/chat/blocks'
import { ChatSidebar } from '../../components/chat/ChatSidebar'
import { useDrawer } from '../../components/Drawer'
import { useModal } from '../../components/Modal'
import { GameStatePanel } from '../../components/chat/GameStatePanel'
import { ChatList } from '../../components/chats'
import { Em } from '../../components/typography/Em'
import type { Chat, ChatMessage as ChatMessageType } from '@shared/types'
import { PlaybackProvider, usePlayback } from '../../components/chat/playback'
import { ActivityOverlay } from '../../components/ActivityOverlay'
import { ShowOn } from '../../components/ShowOn'
import { viewport } from '../../viewport'

const PAGE_SIZE = 60    // how many messages to load per sentinel-trigger
const WINDOW_SIZE = 200 // max messages rendered to the DOM at once

type ChatView = 'list' | 'conversation'

export const Route = createFileRoute('/chat/')({
  component: RouteComponent,
})

function RouteComponent() {
  const [view, setView] = createSignal<ChatView>('list')

  const goToConversation = () => setView('conversation')
  const goToList = () => setView('list')

  // Both views are rendered simultaneously; we hide the inactive one via CSS so
  // their local state (sort, scroll, dropdowns, modals) survives switching.
  return (
    <>
      <div class="flex flex-col h-full overflow-hidden" classList={{ hidden: view() !== 'list' }}>
        <ChatListView onOpen={goToConversation} onCreate={goToConversation} />
      </div>
      <div class="flex flex-col h-full overflow-hidden" classList={{ hidden: view() !== 'conversation' }}>
        <ConversationView onBack={goToList} />
      </div>
    </>
  )
}

function ChatListView(props: { onOpen: () => void; onCreate: () => void }) {
  const modal = useModal()
  const navigate = useNavigate()

  const openChat = async (chat: Chat) => {
    await trpc.chat.load.mutate({ id: chat.id })
    props.onOpen()
  }

  const editChat = (chat: Chat) => {
    navigate({ to: '/chat/$id', params: { id: chat.id }, search: { new: false, isTemplate: chat.isTemplate } })
  }

  const createChat = async () => {
    await trpc.chat.create.mutate({ title: 'Untitled Chat' })
    props.onCreate()
  }

  const saveAsTemplate = async (chat: Chat) => {
    await trpc.chat.saveAsTemplate.mutate({ sourceChatId: chat.id })
  }

  // Scenarios (isTemplate) have their own screen; this list is real chats only.
  const filteredChats = () => Object.values(state.assets.chats ?? {}).filter(c => !c.isTemplate)

  const renameChat = (chat: Chat) => {
    const [title, setTitle] = createSignal(chat.title)
    modal.open({
      title: 'Rename Chat',
      content: () => (
        <div class="flex flex-col gap-3">
          <label class="flex flex-col gap-1">
            <Text size="sm" class="opacity-50">Title</Text>
            <input
              type="text"
              value={title()}
              class="p-2 rounded-lg bg-(--bg) border border-[color-mix(in_oklch,var(--text),transparent_85%)]"
              onInput={(e) => setTitle(e.currentTarget.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submit() } }}
              autofocus
            />
          </label>
          <div class="modal-confirm-actions">
            <button class="modal-btn modal-btn-cancel" onClick={() => modal.close()}>Cancel</button>
            <button class="modal-btn modal-btn-confirm" onClick={submit}>Save</button>
          </div>
        </div>
      ),
    })

    async function submit() {
      const newTitle = title().trim()
      if (newTitle && newTitle !== chat.title) {
        await trpc.chat.rename.mutate({ id: chat.id, title: newTitle })
      }
      modal.close()
    }
  }

  const deleteChat = (chat: Chat) => {
    modal.open({
      title: 'Delete Chat',
      content: () => (
        <div>
          <Text>Are you sure you want to delete <Em type="danger" bold>{chat.title}</Em>?</Text>
          <div class="modal-confirm-actions">
            <button class="modal-btn modal-btn-cancel" onClick={() => modal.close()}>Cancel</button>
            <button
              class="modal-btn modal-btn-confirm"
              onClick={() => { trpc.chat.delete.mutate({ id: chat.id }); modal.close() }}
            >
              Confirm
            </button>
          </div>
        </div>
      ),
    })
  }

  return (
    <>
      <TopBar
        title="Chats"
        slots={{
          right: (
            <button onClick={createChat}>
              <MdFillAdd size={32} />
            </button>
          ),
        }}
      />
      <div class="flex-1 overflow-y-auto">
        <ChatList
          chats={filteredChats()}
          onChatClick={openChat}
          actions={[
            { label: 'Open', callback: openChat },
            { label: 'Edit', callback: editChat },
            { label: 'Rename', callback: renameChat },
            { label: 'Save as Scenario', callback: saveAsTemplate },
            { label: 'Delete', danger: true, callback: deleteChat },
          ]}
        />
      </div>
    </>
  )
}

function ConversationView(props: { onBack: () => void }) {
  // PlaybackProvider must wrap everything that consumes playback state via
  // usePlayback() — the top-bar HUD reads `effectiveGameState`, ChatMessage
  // reads cursor/playingMessageId, and ChatInput calls skipAll() on send.
  return (
    <PlaybackProvider>
      <ConversationViewBody onBack={props.onBack} />
    </PlaybackProvider>
  )
}

function ConversationViewBody(props: { onBack: () => void }) {
  const drawer = useDrawer()
  const playback = usePlayback()

  /**
   * Pagination model:
   *   - `pinnedIds === null`: follow-latest mode. The memo reads the full messages
   *     record and returns the last PAGE_SIZE messages (sorted by createdAt).
   *   - `pinnedIds === string[]`: frozen window. The memo looks up each id
   *     individually. Solid's fine-grained store reactivity means adding a NEW
   *     message id to the record does NOT invalidate reads of the specific pinned
   *     ids — so the window stays put, no re-render.
   *
   * Ordering is always by `createdAt` (with `id` as lexicographic tiebreaker
   * for determinism when timestamps collide).
   */
  const [pinnedIds, setPinnedIds] = createSignal<string[] | null>(null)

  // Drop back to follow-latest whenever the active chat changes. The pinned ids
  // are message ids from the previously-loaded chat; looking them up in the new
  // chat's messages record would all miss and render the list as empty.
  createEffect(() => {
    state.currentChat.id
    setPinnedIds(null)
  })

  // If any pinned id gets deleted from the store (rewind, regenerate, delete),
  // drop back to follow-latest. Pinned mode reads specific ids and never touches
  // Object.values, so new inserts after a stale deletion wouldn't invalidate the
  // memo — the window would silently stop reflecting reality.
  createEffect(() => {
    const pinned = pinnedIds()
    if (pinned === null) return
    for (const id of pinned) {
      if (!state.currentChat.messages[id]) {
        setPinnedIds(null)
        return
      }
    }
  })

  const sortByCreatedAt = (a: ChatMessageType, b: ChatMessageType) =>
    (a.createdAt - b.createdAt) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)

  const unreadCount = createMemo(() => {
    const pinned = pinnedIds()
    if (pinned === null || pinned.length === 0) return 0
    const pinnedLastId = pinned[pinned.length - 1]
    const pinnedLast = state.currentChat.messages[pinnedLastId]
    if (!pinnedLast) return 0
    return Object.values(state.currentChat.messages ?? {})
      .filter(m => sortByCreatedAt(m, pinnedLast) > 0)
      .length
  })

  const visibleMessages = createMemo<ChatMessageType[]>(() => {
    const pinned = pinnedIds()
    if (pinned !== null) {
      const result: ChatMessageType[] = []
      for (const id of pinned) {
        const m = state.currentChat.messages[id]
        if (m) result.push(m)
      }
      return result
    }
    const all = Object.values(state.currentChat.messages ?? {})
    const sliced = all.sort(sortByCreatedAt).slice(-PAGE_SIZE)
    return sliced
  })

  let scrollEl: HTMLDivElement | undefined

  // In follow-latest mode, keep the scroll parked at the bottom whenever the
  // visible message list changes — covers initial chat open (render starts at
  // scrollTop=0 otherwise) and streaming new messages.
  // The 1-pixel buffer keeps scrollTop off the exact maximum: iOS Safari treats
  // an at-extreme scroller as unable to consume touch and routes the gesture to
  // an ancestor, but the root is position:fixed so the gesture is discarded.
  // While a message is mid-playback we skip the pin entirely. Each playing
  // message reserves its full final height upfront (visibility:hidden tail of
  // future blocks in ChatMessage), so pinning to the bottom would land the
  // user on the empty hidden region below the typewriter. Staying at the
  // previous scroll position leaves the user just above the new message —
  // they scroll into it at their own pace, which is the whole point of the
  // height-reservation design.
  createEffect(() => {
    if (pinnedIds() !== null) return
    visibleMessages() // subscribe to changes
    queueMicrotask(() => {
      if (!scrollEl) return
      if (playback.playingMessageId() !== null) return
      scrollEl.scrollTop = Math.max(0, scrollEl.scrollHeight - scrollEl.clientHeight - 1)
    })
  })

  /**
   * Presentational layout hints, derived in one forward pass over the same
   * window the feed renders:
   *   - `prevBlock`: the last thing the reader saw before this message. Agent
   *     turns emit one block per message, so a block's on-screen neighbour
   *     usually lives in the previous message.
   *   - `portraitSide`: portrait images alternate left/right down the feed.
   *
   * Parity comes from the rendered window, so loading older history can flip
   * which side an image sits on. That's acceptable for something purely
   * decorative — and far cheaper than re-deriving it from the whole log.
   */
  const layouts = createMemo(() => {
    const map = new Map<string, { prevBlock?: Block; portraitSide: 'left' | 'right' }>()
    let prevBlock: Block | undefined
    let portraits = 0

    for (const message of visibleMessages()) {
      map.set(message.id, {
        prevBlock,
        portraitSide: portraits % 2 === 0 ? 'left' : 'right',
      })
      for (const block of parseBlocks(message.content)) {
        if (block.type === 'image' && block.aspect === 'portrait') portraits++
      }
      const last = lastRenderedBlock(message.content)
      if (last) prevBlock = last
    }
    return map
  })

  const pinCurrentWindow = () => {
    if (pinnedIds() !== null) return
    const ids = untrack(() => visibleMessages().map(m => m.id))
    setPinnedIds(ids)
  }

  const unpinToLatest = () => {
    setPinnedIds(null)
    queueMicrotask(() => {
      if (!scrollEl) return
      scrollEl.scrollTop = Math.max(0, scrollEl.scrollHeight - scrollEl.clientHeight - 1)
    })
  }

  const loadMoreHistory = () => {
    const current = pinnedIds()
    if (current === null || current.length === 0) return
    const oldestMsg = untrack(() => state.currentChat.messages[current[0]])
    if (!oldestMsg) return
    const older = Object.values(untrack(() => state.currentChat.messages ?? {}))
      .filter(m => sortByCreatedAt(m, oldestMsg) < 0)
      .sort(sortByCreatedAt)
      .slice(-PAGE_SIZE)
      .map(m => m.id)
    if (older.length === 0) return
    // Cap window by dropping items off the bottom (newest) when prepending older.
    setPinnedIds([...older, ...current].slice(0, WINDOW_SIZE))
  }

  const loadMoreForward = () => {
    const current = pinnedIds()
    if (current === null || current.length === 0) return
    const newestMsg = untrack(() => state.currentChat.messages[current[current.length - 1]])
    if (!newestMsg) return
    const newer = Object.values(untrack(() => state.currentChat.messages ?? {}))
      .filter(m => sortByCreatedAt(m, newestMsg) > 0)
      .sort(sortByCreatedAt)
      .slice(0, PAGE_SIZE)
      .map(m => m.id)
    if (newer.length === 0) return
    // Cap window by dropping items off the top (oldest) when appending newer.
    setPinnedIds([...current, ...newer].slice(-WINDOW_SIZE))
  }

  const pinnedWindowHasLatest = () => {
    const current = pinnedIds()
    if (current === null || current.length === 0) return true
    const allMsgs = Object.values(untrack(() => state.currentChat.messages ?? {}))
    if (allMsgs.length === 0) return true
    const latest = allMsgs.reduce((a, b) => sortByCreatedAt(a, b) > 0 ? a : b)
    return current[current.length - 1] === latest.id
  }

  let topSentinelRef: HTMLDivElement | undefined
  let bottomSentinelRef: HTMLDivElement | undefined

  onMount(() => {
    // createViewportObserver needs the scroll container as `root` so it fires
    // when sentinels enter/leave that container (not the window viewport).
    const [observe] = createViewportObserver({ root: scrollEl })

    if (topSentinelRef) {
      observe(topSentinelRef, (entry) => {
        if (entry.isIntersecting) loadMoreHistory()
      })
    }

    if (bottomSentinelRef) {
      observe(bottomSentinelRef, (entry) => {
        if (entry.isIntersecting) {
          // At (or near) the latest message. If we're in frozen-window mode,
          // either extend forward or drop back to follow-latest.
          if (pinnedIds() !== null) {
            if (pinnedWindowHasLatest()) {
              setPinnedIds(null)
            } else {
              loadMoreForward()
            }
          }
        } else {
          // User scrolled away from the bottom — freeze the window so new
          // incoming messages don't shift the view.
          if (pinnedIds() === null) pinCurrentWindow()
        }
      })
    }
  })

  /**
   * On a wide screen the sidebar is part of the layout rather than an overlay:
   * opening it narrows the chat instead of covering it, so the feed and the
   * bottom band stay fully usable while you're picking actors or notes. Narrow
   * screens have no width to give, so they keep the overlay drawer.
   */
  const [inlineSidebar, setInlineSidebar] = createSignal(false)

  const toggleSidebar = () => {
    if (viewport() === 'wide') setInlineSidebar((open) => !open)
    else drawer.open({ content: () => <ChatSidebar /> })
  }

  return (
    <>
      <TopBar
        title={state.currentChat.title || 'Chat'}
        backButton={props.onBack}
        height="60px"
        slots={{
          right: (
            <button onClick={toggleSidebar} title="Actors & notes">
              <MdFillView_sidebar size={48} />
            </button>
          ),
        }}
      />

      <div class="chat-layout">
        <div class="chat-main flex flex-col grow min-h-0 relative">
          <Show when={state.isGenerating}>
            <div class="chat-generation-indicator" aria-hidden="true" />
          </Show>
          <ActivityOverlay />
          <Show when={playback.effectiveGameState().scene.location}>
            {(loc) => (
              <div class="chat-location-overlay" aria-hidden="true">
                <Text size="sm" class="chat-location-label">{loc()}</Text>
              </div>
            )}
          </Show>
          <div
            ref={scrollEl}
            class="chat-messages flex-1 overflow-y-auto"
          >
            <div ref={topSentinelRef} class="chat-messages-sentinel" />
            <For
              each={visibleMessages()}
              fallback={<Text size="sm" class="p-4 opacity-50">No messages yet</Text>}
            >
              {(message) => (
                <ChatMessage
                  message={message}
                  prevBlock={layouts().get(message.id)?.prevBlock}
                  portraitSide={layouts().get(message.id)?.portraitSide ?? 'left'}
                />
              )}
            </For>
            <div ref={bottomSentinelRef} class="chat-messages-sentinel" />
          </div>

          <Show when={pinnedIds() !== null && unreadCount() > 0}>
            <button
              class="chat-jump-to-latest"
              onClick={unpinToLatest}
            >
              {unreadCount()} new — jump to latest
            </button>
          </Show>
            <GameStatePanel />
          </div>

        {/* Kept mounted so the width can transition — a conditionally rendered
            element has nothing to animate from. ChatSidebar is pure memos with
            no effects or subscriptions, so an idle mount costs nothing. */}
        <ShowOn viewport="wide">
          <aside
            class="chat-side-panel"
            classList={{ open: inlineSidebar() }}
            aria-hidden={!inlineSidebar()}
          >
            <div class="chat-side-panel-inner">
              <ChatSidebar />
            </div>
          </aside>
        </ShowOn>
      </div>
    </>
  )
}
