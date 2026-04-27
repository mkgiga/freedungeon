import { createFileRoute, useNavigate } from '@tanstack/solid-router'
import { nanoid } from 'nanoid'
import { state } from '../../state'
import { trpc } from '../../trpc'
import { TopBar } from '../../components/TopBar'
import { createEffect, createMemo, createSignal, For, onMount, Show, untrack } from 'solid-js'
import { createViewportObserver } from '@solid-primitives/intersection-observer'
import { MdFillAdd, MdFillView_sidebar } from 'solid-icons/md'
import { Text } from '../../components/typography/Text'
import { ChatMessage } from '../../components/chat/ChatMessage'
import { ChatInput } from '../../components/chat/ChatInput'
import { ChatSidebar } from '../../components/chat/ChatSidebar'
import { useDrawer } from '../../components/Drawer'
import { useModal } from '../../components/Modal'
import { GameStateActorStatus } from '../../components/GameStateActorStatus'
import { ChatList } from '../../components/chats'
import { Em } from '../../components/typography/Em'
import type { Chat, ChatMessage as ChatMessageType } from '@shared/types'
import { Spacer } from '../../components/Spacer'
import { Toolbar } from '../../components/Toolbar'

const PAGE_SIZE = 30    // how many messages to load per sentinel-trigger
const WINDOW_SIZE = 100 // max messages rendered to the DOM at once

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
  const [tab, setTab] = createSignal<'chats' | 'templates'>('chats')

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

  const createTemplate = () => {
    // Optimistic-create pattern: generate an id client-side and navigate into
    // the detail view. The server sees nothing until the user hits Save.
    const newId = nanoid()
    navigate({ to: '/chat/$id', params: { id: newId }, search: { new: true, isTemplate: true } })
  }

  const saveAsTemplate = async (chat: Chat) => {
    await trpc.chat.saveAsTemplate.mutate({ sourceChatId: chat.id })
  }

  const useTemplate = async (template: Chat) => {
    await trpc.chat.useTemplate.mutate({ templateId: template.id })
    props.onOpen()
  }

  const filteredChats = () => {
    const all = Object.values(state.assets.chats ?? {})
    return all.filter(c => tab() === 'templates' ? c.isTemplate : !c.isTemplate)
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
        title={tab() === 'templates' ? 'Templates' : 'Chats'}
        slots={{
          right: (
            <button onClick={tab() === 'templates' ? createTemplate : createChat}>
              <MdFillAdd size={32} />
            </button>
          ),
        }}
      />
      <div class="flex-1 overflow-y-auto">
        <ChatList
          chats={filteredChats()}
          onChatClick={tab() === 'templates' ? editChat : openChat}
          toolbar={
            <>
              <button
                class="chat-list-tab"
                classList={{ 'is-active': tab() === 'chats' }}
                onClick={() => setTab('chats')}
              >Chats</button>
              <button
                class="chat-list-tab"
                classList={{ 'is-active': tab() === 'templates' }}
                onClick={() => setTab('templates')}
              >Templates</button>
            </>
          }
          actions={tab() === 'templates'
            ? [
                { label: 'Use Template', callback: useTemplate },
                { label: 'Edit', callback: editChat },
                { label: 'Open', callback: openChat },
                { label: 'Rename', callback: renameChat },
                { label: 'Delete', danger: true, callback: deleteChat },
              ]
            : [
                { label: 'Open', callback: openChat },
                { label: 'Edit', callback: editChat },
                { label: 'Rename', callback: renameChat },
                { label: 'Save as Template', callback: saveAsTemplate },
                { label: 'Delete', danger: true, callback: deleteChat },
              ]
          }
        />
      </div>
    </>
  )
}

function ConversationView(props: { onBack: () => void }) {
  const drawer = useDrawer()
  const modal = useModal()

  const resolveActorName = (customId: string) => {
    for (const a of Object.values(state.assets.actors)) {
      if (a.customId === customId) return a.name
    }
    return customId
  }

  const resolvePlayerActor = () => {
    const playerId = state.userPreferences.playerCharacterId
    if (!playerId) return null
    return state.assets.actors?.[playerId] ?? null
  }

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
  createEffect(() => {
    if (pinnedIds() !== null) return
    visibleMessages() // subscribe to changes
    queueMicrotask(() => {
      if (!scrollEl) return
      scrollEl.scrollTop = Math.max(0, scrollEl.scrollHeight - scrollEl.clientHeight - 1)
    })
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
        height="60px"
        slots={{
          left: (
            <>
              <Spacer dir={'horizontal'} size={'md'} />
              <div class="chat-topbar-actors">
                <For each={Object.entries(state.currentChat.gameState.scene.actors.active).sort(([idA], [idB]) => {
                  const hasAvatarA = Boolean(state.assets.actors[idA]?.avatarUrl?.length)
                  const hasAvatarB = Boolean(state.assets.actors[idB]?.avatarUrl?.length)
                  if (hasAvatarA !== hasAvatarB) return hasAvatarA ? -1 : 1
                  return resolveActorName(idA).localeCompare(resolveActorName(idB))
                })}>
                  {([customId, actorState]) => (
                    /* Only render NPCs here - the player character is rendered elsewhere */
                    <Show when={customId !== resolvePlayerActor()?.customId}>
                      <GameStateActorStatus
                        customId={customId}
                        hp={actorState.hp}
                        variant="compact"
                        onClick={() => modal.open({
                          title: resolveActorName(customId),
                          content: () => (
                            <GameStateActorStatus
                              customId={customId}
                              hp={actorState.hp}
                              variant="presentation"
                            />
                          ),
                        })}
                      />
                    </Show>
                  )}
                </For>
              </div>
            </>
          ),
          right: (
            <button onClick={openSidebar}>
              <MdFillView_sidebar size={48} />
            </button>
          ),
        }}
      />

      <div class="chat-main flex flex-col grow min-h-0 relative">
        <Show when={state.isGenerating}>
          <div class="chat-generation-indicator" aria-hidden="true" />
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
            {(message) => <ChatMessage message={message} />}
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
        <Spacer dir='vertical' size={12} />
        <ChatInput />
      </div>
    </>
  )
}
