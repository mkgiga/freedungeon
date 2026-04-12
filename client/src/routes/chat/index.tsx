import { createFileRoute } from '@tanstack/solid-router'
import { state } from '../../state'
import { trpc } from '../../trpc'
import { TopBar } from '../../components/TopBar'
import { createMemo, createSignal, For, Show, untrack } from 'solid-js'
import { MdFillAdd, MdFillView_sidebar } from 'solid-icons/md'
import { Text } from '../../components/typography/Text'
import { ChatMessage } from '../../components/chat/ChatMessage'
import { ChatInput } from '../../components/chat/ChatInput'
import { ChatSidebar } from '../../components/chat/ChatSidebar'
import { useDrawer } from '../../components/Drawer'
import { useModal } from '../../components/Modal'
import { ChatList } from '../../components/chats'
import { Em } from '../../components/typography/Em'
import type { Chat, ChatMessage as ChatMessageType } from '@shared/types'

const PAGE_SIZE = 30
const BOTTOM_THRESHOLD = 50 // px from bottom to count as "at bottom"
const TOP_THRESHOLD = 100   // px from top to trigger load more history

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
      <div class="flex flex-col h-full" classList={{ hidden: view() !== 'list' }}>
        <ChatListView onOpen={goToConversation} onCreate={goToConversation} />
      </div>
      <div class="flex flex-col h-full" classList={{ hidden: view() !== 'conversation' }}>
        <ConversationView onBack={goToList} />
      </div>
    </>
  )
}

function ChatListView(props: { onOpen: () => void; onCreate: () => void }) {
  const modal = useModal()

  const openChat = async (chat: Chat) => {
    await trpc.chat.load.mutate({ id: chat.id })
    props.onOpen()
  }

  const createChat = async () => {
    await trpc.chat.create.mutate({ title: 'Untitled Chat' })
    props.onCreate()
  }

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
          chats={Object.values(state.assets.chats ?? {})}
          onChatClick={openChat}
          actions={[
            { label: 'Open', callback: openChat },
            { label: 'Rename', callback: renameChat },
            { label: 'Delete', danger: true, callback: deleteChat },
          ]}
        />
      </div>
    </>
  )
}

function ConversationView(props: { onBack: () => void }) {
  const drawer = useDrawer()

  /**
   * Pagination model:
   *   - `pinnedIds === null`: follow-latest mode. The memo reads the full messages
   *     record and returns the last PAGE_SIZE messages. New messages appear live.
   *   - `pinnedIds === number[]`: frozen window. The memo looks up each id
   *     individually. Solid's fine-grained store reactivity means adding a NEW
   *     message id to the record does NOT invalidate reads of the specific pinned
   *     ids — so the window stays put, no re-render.
   */
  const [pinnedIds, setPinnedIds] = createSignal<number[] | null>(null)

  const unreadCount = createMemo(() => {
    const pinned = pinnedIds()
    if (pinned === null) return 0
    const allIds = Object.keys(state.currentChat.messages ?? {}).map(Number)
    const pinnedMax = pinned.length > 0 ? pinned[pinned.length - 1] : -Infinity
    return allIds.filter(id => id > pinnedMax).length
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
    return Object.values(state.currentChat.messages ?? {})
      .sort((a, b) => a.id - b.id)
      .slice(-PAGE_SIZE)
  })

  let scrollEl: HTMLDivElement | undefined

  const pinCurrentWindow = () => {
    if (pinnedIds() !== null) return
    const ids = untrack(() => visibleMessages().map(m => m.id))
    setPinnedIds(ids)
  }

  const unpinToLatest = () => {
    setPinnedIds(null)
    queueMicrotask(() => {
      if (scrollEl) scrollEl.scrollTop = scrollEl.scrollHeight
    })
  }

  const loadMoreHistory = () => {
    const current = pinnedIds()
    if (current === null || current.length === 0) return
    const oldest = current[0]
    const older = Object.values(untrack(() => state.currentChat.messages ?? {}))
      .filter(m => m.id < oldest)
      .sort((a, b) => a.id - b.id)
      .slice(-PAGE_SIZE)
      .map(m => m.id)
    if (older.length === 0) return
    setPinnedIds([...older, ...current])
  }

  const loadMoreForward = () => {
    const current = pinnedIds()
    if (current === null || current.length === 0) return
    const newest = current[current.length - 1]
    const newer = Object.values(untrack(() => state.currentChat.messages ?? {}))
      .filter(m => m.id > newest)
      .sort((a, b) => a.id - b.id)
      .slice(0, PAGE_SIZE)
      .map(m => m.id)
    if (newer.length === 0) return
    setPinnedIds([...current, ...newer])
  }

  const pinnedWindowHasLatest = () => {
    const current = pinnedIds()
    if (current === null || current.length === 0) return true
    const allIds = untrack(() => Object.keys(state.currentChat.messages ?? {})).map(Number)
    if (allIds.length === 0) return true
    const maxId = Math.max(...allIds)
    return current[current.length - 1] === maxId
  }

  const onScroll = (e: Event) => {
    const el = e.currentTarget as HTMLDivElement
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight

    if (distanceFromBottom < BOTTOM_THRESHOLD) {
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

    if (el.scrollTop < TOP_THRESHOLD) {
      loadMoreHistory()
    }
  }

  const openSidebar = () => {
    drawer.open({
      content: () => <ChatSidebar />,
    })
  }

  return (
    <>
      <TopBar
        title={state.currentChat.title || 'Chat'}
        backButton={props.onBack}
        slots={{
          right: (
            <button onClick={openSidebar}>
              <MdFillView_sidebar size={32} />
            </button>
          ),
        }}
      />

      <div class="chat-main flex flex-col grow min-h-0 relative">
        <div
          ref={scrollEl}
          class="chat-messages flex-1 overflow-y-auto"
          onScroll={onScroll}
        >
          <For
            each={visibleMessages()}
            fallback={<Text size="sm" class="p-4 opacity-50">No messages yet</Text>}
          >
            {(message) => <ChatMessage message={message} />}
          </For>
        </div>

        <Show when={pinnedIds() !== null && unreadCount() > 0}>
          <button
            class="chat-jump-to-latest"
            onClick={unpinToLatest}
          >
            {unreadCount()} new — jump to latest
          </button>
        </Show>

        <ChatInput />
      </div>
    </>
  )
}
