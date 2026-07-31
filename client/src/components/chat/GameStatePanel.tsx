import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show, untrack } from 'solid-js'
import autoAnimate from '@formkit/auto-animate'
import { state } from '../../state'
import { trpc } from '../../trpc'
import { useModal } from '../Modal'
import { GameStateActorStatus } from '../GameStateActorStatus'
import { PlayerCharacterPicker } from './AssetPicker'
import { pickEmojiForItem } from './inventory/itemEmoji'
import { resolveItem } from './inventory/resolveItem'
import { ItemCard } from './inventory/ItemCard'
import { usePlayback } from './playback'
import { serializeBlocks } from './blocks'
import { startItemDrag } from './itemDrag'
import { ChatInput, createPendingChoicePrompt } from './ChatInput'
import { MdFillChat, MdFillGroups, MdFillKeyboard_arrow_down, MdFillKeyboard_arrow_up, MdFillPerson, MdFillBackpack } from 'solid-icons/md'

/**
 * The persistent bottom band. It is one container with two faces: the present
 * actors (player + NPCs, small vertical cards) by default, or the composer once
 * the user taps the top-right bubble — the two never coexist, so neither has to
 * give up horizontal room for the other. The bubble becomes an ✕ while the
 * composer is up.
 *
 * The inventory hangs off the band's top edge in a drawer opened by the handle,
 * overlaying the message feed rather than reflowing it. It's anchor-positioned
 * against the band (`anchor-name: --chat-bottom-ui`) so it stays glued to the
 * top edge as the band grows with the composer's text.
 *
 * NPC cards reorder by "recency": an actor whose HP changes (or who just
 * entered) jumps to the front of the NPCs. The recency signal is derived purely
 * client-side by diffing the replayed game state — the shared game-state code
 * stays pure (it also runs on the server). auto-animate FLIP-animates the
 * resulting DOM reorder.
 */
export function GameStatePanel() {
    const modal = useModal()
    const playback = usePlayback()

    const [mode, setMode] = createSignal<'actors' | 'composer'>('actors')
    const [inventoryOpen, setInventoryOpen] = createSignal(false)

    // A menu the agent just offered is unusable while the composer is hidden, so
    // surface it. Keyed on the message id: re-opening only follows a *new* menu,
    // otherwise dismissing one that's still pending would immediately undo itself.
    const pendingChoicePrompt = createPendingChoicePrompt()
    let autoOpenedFor: string | null = null
    createEffect(() => {
        const pending = pendingChoicePrompt()
        if (!pending) {
            autoOpenedFor = null
            return
        }
        if (pending.messageId !== autoOpenedFor) {
            autoOpenedFor = pending.messageId
            setMode('composer')
        }
    })

    const resolveActorName = (customId: string) => {
        for (const a of Object.values(state.assets.actors)) {
            if (a.customId === customId) return a.name
        }
        return customId
    }

    const playerActor = createMemo(() => {
        const id = state.userPreferences.playerCharacterId
        if (!id) return null
        return state.assets.actors?.[id] ?? null
    })

    const hpOf = (customId: string): number | null =>
        playback.effectiveGameState().scene.actors.active[customId]?.hp ?? null

    // ── Recency tracking (client-side, derived from the replayed state) ──
    // Bump an actor's recency counter whenever their HP changes or they newly
    // enter the active scene, so the NPC list can sort most-recently-active
    // first. Diffing the reactive state needs no hooks in the shared module.
    const recency = new Map<string, number>()
    let recencyCounter = 0
    let prevHp: Record<string, number> = {}
    let prevChatId: string | null = null
    const [recencyVersion, setRecencyVersion] = createSignal(0)

    createEffect(() => {
        const chatId = state.currentChat.id
        const active = playback.effectiveGameState().scene.actors.active
        const curHp: Record<string, number> = {}
        for (const id in active) curHp[id] = active[id]!.hp

        untrack(() => {
            // Chat switch: reseed without bumping so a fresh chat doesn't shuffle.
            if (chatId !== prevChatId) {
                prevChatId = chatId
                prevHp = curHp
                recency.clear()
                recencyCounter = 0
                setRecencyVersion(v => v + 1)
                return
            }
            let changed = false
            for (const id in curHp) {
                const was = prevHp[id]
                if (was === undefined || was !== curHp[id]) {
                    recency.set(id, ++recencyCounter)
                    changed = true
                }
            }
            prevHp = curHp
            if (changed) setRecencyVersion(v => v + 1)
        })
    })

    // NPC ids (player excluded), most-recently-active first, then avatar-first,
    // then name. Returns stable customId strings so <For> MOVES the card nodes
    // on reorder (required for the auto-animate FLIP to fire).
    const npcIds = createMemo(() => {
        recencyVersion() // re-sort when recency changes
        const playerCustomId = playerActor()?.customId
        return Object.keys(playback.effectiveGameState().scene.actors.active)
            .filter(id => id !== playerCustomId)
            .sort((a, b) => {
                const ra = recency.get(a) ?? 0
                const rb = recency.get(b) ?? 0
                if (ra !== rb) return rb - ra
                const hasAvatarA = Boolean(state.assets.actors[a]?.avatarUrl?.length)
                const hasAvatarB = Boolean(state.assets.actors[b]?.avatarUrl?.length)
                if (hasAvatarA !== hasAvatarB) return hasAvatarA ? -1 : 1
                return resolveActorName(a).localeCompare(resolveActorName(b))
            })
    })

    const items = createMemo(() => {
        const ctx = playback.effectiveGameState()
        return Object.entries(ctx.inventory ?? {})
            .filter(([, qty]) => qty > 0)
            .map(([key, qty]) => ({ ...resolveItem(ctx, key), qty }))
            .sort((a, b) => a.label.localeCompare(b.label))
    })

    const openPlayerPicker = () => {
        modal.open({
            title: 'Player Character',
            content: () => <PlayerCharacterPicker onPick={() => modal.close()} />,
        })
    }

    const openActorStatus = (customId: string) => {
        modal.open({
            title: resolveActorName(customId),
            content: () => <GameStateActorStatus customId={customId} hp={hpOf(customId) ?? 0} variant="presentation" />,
        })
    }

    const bindActorsRail = (el: HTMLDivElement) => autoAnimate(el)

    // ── Item detail card ──
    // Desktop opens it on hover; touch has no hover, so a tap toggles it. A tap
    // is "pointerup without the drag threshold having been crossed" — the drag
    // itself reports via startItemDrag's onDragStart.
    const [card, setCard] = createSignal<{ key: string; anchor: DOMRect } | null>(null)
    const openCard = (key: string, el: HTMLElement) => setCard({ key, anchor: el.getBoundingClientRect() })
    const closeCard = () => setCard(null)
    const cardItem = createMemo(() => {
        const open = card()
        return open ? items().find((i) => i.key === open.key) : undefined
    })

    onMount(() => {
        // Any press that isn't on a slot dismisses. Slots are excluded so
        // tapping a different item switches the card rather than closing it —
        // this runs on bubble, after the slot's own handler.
        const onDocDown = (e: PointerEvent) => {
            if (!(e.target as HTMLElement | null)?.closest('.chat-inventory-slot')) closeCard()
        }
        // The anchor rect is captured at open time, so it goes stale if the
        // layout shifts underneath it.
        const onLayoutChange = () => closeCard()
        document.addEventListener('pointerdown', onDocDown)
        window.addEventListener('resize', onLayoutChange)
        window.addEventListener('scroll', onLayoutChange, true)
        onCleanup(() => {
            document.removeEventListener('pointerdown', onDocDown)
            window.removeEventListener('resize', onLayoutChange)
            window.removeEventListener('scroll', onLayoutChange, true)
        })
    })

    // Dropping an item on an actor submits a mechanical use *attempt* as a
    // user turn; the agent adjudicates it via the use_item tool.
    const sendTryUse = (item: string, actorId: string) => {
        if (state.isGenerating) return
        playback.skipAll()
        trpc.chat.prompt.mutate({
            message: serializeBlocks([{ type: 'tryUse', what: `item:${item}`, on: `actor:${actorId}` }]),
        })
    }

    return (
        <>
            {/* Anchored to the band's top edge, growing upward over the feed. A
              * sibling of the band, not a child: `anchor-size()` is invalid when
              * the anchor is an ancestor of the positioned element (it would be a
              * circular size dependency), so the drawer couldn't take the band's
              * width from inside it. */}
            <div class="chat-inventory-dock">
                <Show
                    when={inventoryOpen()}
                    fallback={
                        <button
                            class="chat-inventory-handle"
                            onClick={() => setInventoryOpen(true)}
                            title="Show inventory"
                            aria-expanded={false}
                        >
                            <MdFillBackpack size={24} />
                        </button>
                    }
                >
                    <div class="chat-inventory-drawer">
                        {/* Collapse control lives inside the open drawer rather than
                          * floating over the feed as a tab. */}
                        <div class="chat-inventory-drawer-header">
                            <button
                                class="chat-inventory-collapse"
                                onClick={() => setInventoryOpen(false)}
                                title="Hide inventory"
                                aria-expanded={true}
                            >
                                <MdFillKeyboard_arrow_down size={32} />
                            </button>
                        </div>

                        <div class="chat-inventory-grid">
                            <For each={items()} fallback={<span class="chat-status-inventory-empty">Inventory empty</span>}>
                                {(item) => {
                                    // Set once a drag crosses the threshold, so the
                                    // following pointerup is understood as a drop, not a tap.
                                    let dragged = false
                                    return (
                                        <div
                                            class="chat-inventory-slot"
                                            onPointerDown={(e) => {
                                                dragged = false
                                                if (state.isGenerating) return
                                                startItemDrag(
                                                    e,
                                                    e.currentTarget,
                                                    (actorId) => sendTryUse(item.key, actorId),
                                                    () => { dragged = true; closeCard() },
                                                )
                                            }}
                                            onPointerUp={(e) => {
                                                if (e.pointerType === 'mouse' || dragged) return
                                                if (card()?.key === item.key) closeCard()
                                                else openCard(item.key, e.currentTarget)
                                            }}
                                            onPointerEnter={(e) => {
                                                if (e.pointerType === 'mouse') openCard(item.key, e.currentTarget)
                                            }}
                                            onPointerLeave={(e) => {
                                                if (e.pointerType === 'mouse') closeCard()
                                            }}
                                        >
                                            <Show
                                                when={item.icon}
                                                fallback={<span class="chat-inventory-slot-emoji">{pickEmojiForItem(item.label)}</span>}
                                            >
                                                {(icon) => <img class="chat-inventory-slot-icon" src={icon()} alt={item.label} />}
                                            </Show>
                                            <Show when={item.qty > 1}>
                                                <span class="chat-inventory-slot-qty">{item.qty}</span>
                                            </Show>
                                        </div>
                                    )
                                }}
                            </For>
                        </div>
                    </div>
                </Show>
            </div>

            <div class="chat-status-panel">
                <div class="chat-status-actors" classList={{ hidden: mode() === 'composer' }} ref={bindActorsRail}>
                    <Show
                        when={playerActor()}
                        fallback={
                            <button class="chat-status-set-player" onClick={openPlayerPicker} title="Set player character">
                                <MdFillPerson size={20} />
                            </button>
                        }
                    >
                        {(p) => (
                            <div class="chat-status-card is-player" data-drop-actor={p().customId}>
                                <GameStateActorStatus
                                    customId={p().customId}
                                    hp={hpOf(p().customId) ?? 100}
                                    variant="small"
                                    onClick={openPlayerPicker}
                                />
                            </div>
                        )}
                    </Show>

                    <For each={npcIds()}>
                        {(customId) => (
                            <div class="chat-status-card" data-drop-actor={customId}>
                                <GameStateActorStatus
                                    customId={customId}
                                    hp={hpOf(customId) ?? 0}
                                    variant="small"
                                    onClick={() => openActorStatus(customId)}
                                />
                            </div>
                        )}
                    </For>
                </div>

                <ChatInput hidden={mode() !== 'composer'} />

                <button
                    class="chat-status-toggle"
                    onClick={() => setMode(m => (m === 'composer' ? 'actors' : 'composer'))}
                    title={mode() === 'composer' ? 'Back to the scene' : 'Write a message'}
                >
                    <Show when={mode() === 'composer'} fallback={<MdFillChat size={24} />}>
                        <MdFillGroups size={32} />
                    </Show>
                </button>
            </div>

            <Show when={cardItem()}>
                {(item) => <ItemCard item={item()} anchor={card()!.anchor} />}
            </Show>
        </>
    )
}
