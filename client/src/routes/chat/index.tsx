import { createFileRoute, useNavigate } from '@tanstack/solid-router'
import { state } from '../../state'
import { trpc } from '../../trpc'
import { TopBar } from '../../components/TopBar'
import { createEffect, createMemo, createSignal, For, Match, onMount, Show, Switch, untrack } from 'solid-js'
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
import { chatView, setChatView } from '../../tab-state'
import { useAction } from '../../actions'

const PAGE_SIZE = 60
const WINDOW_SIZE = 200

export const Route = createFileRoute('/chat/')({
  component: RouteComponent,
})

function RouteComponent() {
  const view = chatView

  const goToConversation = () => setChatView('conversation')
  const goToList = () => setChatView('list')

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

  const filteredChats = () => Object.values(state.assets.chats ?? {})
    .filter(c => !c.isTemplate && (c.kind ?? 'roleplay') === 'roleplay')

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
          addNew={{ label: 'New chat', onClick: createChat }}
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
  return (
    <PlaybackProvider>
      <ConversationViewBody onBack={props.onBack} />
    </PlaybackProvider>
  )
}

function ConversationViewBody(props: { onBack: () => void }) {
  const drawer = useDrawer()
  const playback = usePlayback()

  const [pinnedIds, setPinnedIds] = createSignal<string[] | null>(null)

  createEffect(() => {
    state.currentChat.id
    setPinnedIds(null)
  })

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
      // Only what the user could actually have read. Playback holds later
      // messages back until they tap through the current one, and those aren't
      // just below the fold — they aren't rendered at all. Counting them meant
      // the badge raced ahead of the story, telling someone reading at their
      // own pace that they were falling behind.
      .filter(m => m.role !== 'assistant' || playback.isMessageRevealed(m.id))
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

  const scrollToBottom = () => {
    if (!scrollEl) return
    scrollEl.scrollTop = Math.max(0, scrollEl.scrollHeight - scrollEl.clientHeight - 1)
  }

  createEffect(() => {
    if (pinnedIds() !== null) return
    visibleMessages()
    playback.playingMessageId()
    queueMicrotask(() => {
      if (playback.playingMessageId() !== null) return
      scrollToBottom()
    })
  })

  const layouts = createMemo(() => {
    const map = new Map<string, { prevBlock?: Block }>()
    let prevBlock: Block | undefined

    for (const message of visibleMessages()) {
      map.set(message.id, { prevBlock })
      const last = lastRenderedBlock(message.content)
      if (last) prevBlock = last
    }
    return map
  })

  /**
   * A portrait image is half a column wide, so on its own it leaves a tall
   * empty gutter. Instead it is floated and the narration that ran up to it is
   * pulled in beside it, enough of it to cover the image's height and no more.
   * The run stops at anything that isn't narration or dialogue, so a roll, an
   * item or another image never gets swallowed into someone else's layout.
   *
   * Float, not grid: once the text passes the bottom of the image it reclaims
   * the full measure, which is the same behaviour the speech avatar relies on.
   */
  const FLOAT_IMAGE_HEIGHT = 431
  const BODY_CHARS_PER_LINE = 46
  const TEXT_LINE_HEIGHT = 26
  const SPEECH_LINE_HEIGHT = 25

  const estimateHeight = (blocks: Block[]): number => {
    let h = 0
    for (const b of blocks) {
      if (b.type === 'text') {
        h += Math.max(1, Math.ceil(b.content.length / BODY_CHARS_PER_LINE)) * TEXT_LINE_HEIGHT
      } else if (b.type === 'speech') {
        h += Math.max(64, Math.ceil((b.dialogue?.length ?? 0) / 44) * SPEECH_LINE_HEIGHT + 22)
      }
    }
    return h
  }

  type FeedEntry =
    | { kind: 'solo'; message: ChatMessageType }
    | {
        kind: 'float'
        message: ChatMessageType
        body: { message: ChatMessageType; beside: boolean }[]
      }

  /**
   * `For` keys rows by value identity, and the store hands out a new message
   * object only when that message actually changed. Entries are therefore
   * reused whenever every message they point at is the same object as last
   * time - otherwise a recompute (pinning the window, loading more) would
   * hand `For` all-new wrappers, tear down every row and replay every
   * block's entry animation under the reader.
   */
  let feedCache = new Map<string, FeedEntry>()

  const sameEntry = (a: FeedEntry | undefined, b: FeedEntry): boolean => {
    if (!a || a.kind !== b.kind || a.message !== b.message) return false
    if (a.kind === 'solo' || b.kind === 'solo') return true
    return a.body.length === b.body.length
      && a.body.every((m, i) => m.message === b.body[i]!.message && m.beside === b.body[i]!.beside)
  }

  const feed = createMemo<FeedEntry[]>(() => {
    const out: FeedEntry[] = []
    const messages = visibleMessages()

    const narration = (blocks: Block[]): boolean =>
      blocks.length > 0 && blocks.every(b => b.type === 'text' || b.type === 'speech')

    let i = 0
    while (i < messages.length) {
      const message = messages[i]!
      const blocks = parseBlocks(message.content)
      const only = blocks.length === 1 ? blocks[0] : undefined
      if (!only || only.type !== 'image' || only.aspect !== 'portrait') {
        out.push({ kind: 'solo', message })
        i++
        continue
      }

      const before: ChatMessageType[] = []
      const after: ChatMessageType[] = []
      const heights = new Map<ChatMessageType, number>()
      let filled = 0

      while (out.length > 0 && filled < FLOAT_IMAGE_HEIGHT) {
        const prev = out[out.length - 1]!
        if (prev.kind !== 'solo') break
        const prevBlocks = parseBlocks(prev.message.content)
        if (!narration(prevBlocks)) break
        out.pop()
        before.unshift(prev.message)
        heights.set(prev.message, estimateHeight(prevBlocks))
        filled += estimateHeight(prevBlocks)
      }

      // Whatever gutter the earlier narration didn't cover is filled by the
      // narration that follows, which is the direction a float wraps anyway:
      // it runs beside the image and reclaims the full measure the moment it
      // passes the bottom edge.
      let j = i + 1
      while (j < messages.length && filled < FLOAT_IMAGE_HEIGHT) {
        const nextBlocks = parseBlocks(messages[j]!.content)
        if (!narration(nextBlocks)) break
        after.push(messages[j]!)
        heights.set(messages[j]!, estimateHeight(nextBlocks))
        filled += estimateHeight(nextBlocks)
        j++
      }

      const ordered = [...before, ...after]
      if (ordered.length === 0) {
        out.push({ kind: 'solo', message })
        i++
        continue
      }

      // Only the rows that actually run alongside the picture mirror with it;
      // once the stack passes the image's bottom edge the layout is ordinary
      // again, and a portrait pinned to the far margin down there just reads
      // as a mistake.
      let run = 0
      const body = ordered.map((m) => {
        const beside = run < FLOAT_IMAGE_HEIGHT
        run += heights.get(m) ?? 0
        return { message: m, beside }
      })

      out.push({
        kind: 'float',
        message,
        body,
      })
      i = j
    }

    const cache = new Map<string, FeedEntry>()
    const stable = out.map((entry) => {
      const key = `${entry.kind}:${entry.message.id}`
      const reused = sameEntry(feedCache.get(key), entry) ? feedCache.get(key)! : entry
      cache.set(key, reused)
      return reused
    })
    feedCache = cache
    return stable
  })

  const renderMessage = (message: ChatMessageType) => (
    <ChatMessage
      message={message}
      prevBlock={layouts().get(message.id)?.prevBlock}
    />
  )

  const pinCurrentWindow = () => {
    if (pinnedIds() !== null) return
    const ids = untrack(() => visibleMessages().map(m => m.id))
    setPinnedIds(ids)
  }

  const followLatest = () => {
    setPinnedIds(null)
    queueMicrotask(scrollToBottom)
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
    const [observe] = createViewportObserver({ root: scrollEl })

    if (topSentinelRef) {
      observe(topSentinelRef, (entry) => {
        if (entry.isIntersecting) loadMoreHistory()
      })
    }

    if (bottomSentinelRef) {
      observe(bottomSentinelRef, (entry) => {
        if (entry.isIntersecting) {
          if (pinnedIds() !== null) {
            if (pinnedWindowHasLatest()) {
              setPinnedIds(null)
            } else {
              loadMoreForward()
            }
          }
        } else {
          if (pinnedIds() === null) pinCurrentWindow()
        }
      })
    }
  })

  const [inlineSidebar, setInlineSidebar] = createSignal(false)

  useAction('chat.toggleSidebar', () => toggleSidebar())

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
              each={feed()}
              fallback={<Text size="sm" class="p-4 opacity-50">No messages yet</Text>}
            >
              {(entry) => (
                <Switch>
                  <Match when={entry.kind === 'solo'}>
                    {renderMessage(entry.message)}
                  </Match>
                  <Match when={entry.kind === 'float'}>
                    <div class="chat-float-group">
                      <div class="chat-float-media">{renderMessage(entry.message)}</div>
                      <For each={(entry as { body: { message: ChatMessageType }[] }).body}>
                        {(m) => renderMessage(m.message)}
                      </For>
                    </div>
                  </Match>
                </Switch>
              )}
            </For>
            <div ref={bottomSentinelRef} class="chat-messages-sentinel" />
          </div>

          <Show when={pinnedIds() !== null && unreadCount() > 0}>
            <button
              class="chat-jump-to-latest"
              onClick={followLatest}
            >
              {unreadCount()} new — jump to latest
            </button>
          </Show>
            <GameStatePanel />
          </div>

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
