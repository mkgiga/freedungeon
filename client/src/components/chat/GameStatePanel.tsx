import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show, untrack } from 'solid-js'
import autoAnimate from '@formkit/auto-animate'
import { state } from '../../state'
import { trpc } from '../../trpc'
import { useModal } from '../Modal'
import { useToast } from '../Toast'
import { GameStateActorStatus } from '../GameStateActorStatus'
import { useAssetPickers } from './AssetPicker'
import { pickEmojiForItem } from './inventory/itemEmoji'
import { resolveItem } from './inventory/resolveItem'
import { ItemCard } from './inventory/ItemCard'
import { usePlayback } from './playback'
import { serializeBlocks } from './blocks'
import { startItemDrag } from './itemDrag'
import { ChatInput } from './ChatInput'
import { MdFillPerson } from 'solid-icons/md'
import { Loader } from '../Loader'
import { isIconPending } from './inventory/resolveItem'

/**
 * The persistent bottom band: one rail of live state above the text field.
 *
 * Present actors and carried items sit side by side in that rail, inline with
 * the composer's buttons, and are always on screen. They used to be two things
 * you had to go and open — the band flipped between an actor rail and the
 * composer, and the inventory hung off the band's top edge in a drawer over the
 * feed. Both cost a trip away from the text box to see state that is only
 * useful while you are deciding what to type.
 *
 * Everything here is squeezed to fit that row: actors are bare square portraits
 * with a health orb in the corner (variant="micro"), items are their icons. The
 * detail — names, HP numbers, descriptions — is one click away in a modal or
 * the hover card, which is where it was worth reading anyway.
 *
 * NPC cards reorder by "recency": an actor whose HP changes (or who just
 * entered) jumps to the front of the NPCs. The recency signal is derived purely
 * client-side by diffing the replayed game state — the shared game-state code
 * stays pure (it also runs on the server). auto-animate FLIP-animates the
 * resulting DOM reorder.
 */
export function GameStatePanel() {
    const modal = useModal()
    const toast = useToast()
    const pickers = useAssetPickers()
    const playback = usePlayback()

    const actorByCustomId = (customId: string) =>
        Object.values(state.assets.actors).find(a => a.customId === customId) ?? null

    const resolveActorName = (customId: string) => actorByCustomId(customId)?.name ?? customId

    const playerActor = createMemo(() => {
        const id = state.userPreferences.playerCharacterId
        if (!id) return null
        return state.assets.actors?.[id] ?? null
    })

    const hpOf = (customId: string): number | null =>
        playback.effectiveGameState().scene.actors.active[customId]?.hp ?? null

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

    const npcIds = createMemo(() => {
        recencyVersion()
        const playerCustomId = playerActor()?.customId
        return Object.keys(playback.effectiveGameState().scene.actors.active)
            .filter(id => id !== playerCustomId)
            .sort((a, b) => {
                const ra = recency.get(a) ?? 0
                const rb = recency.get(b) ?? 0
                if (ra !== rb) return rb - ra
                const hasAvatarA = Boolean(actorByCustomId(a)?.avatarUrl?.length)
                const hasAvatarB = Boolean(actorByCustomId(b)?.avatarUrl?.length)
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

    const openPlayerPicker = pickers.openPlayerCharacter

    const openActorStatus = (customId: string) => {
        modal.open({
            title: resolveActorName(customId),
            content: () => <GameStateActorStatus customId={customId} hp={hpOf(customId) ?? 0} variant="presentation" />,
        })
    }

    const bindActorsRail = (el: HTMLDivElement) => autoAnimate(el)

    const [card, setCard] = createSignal<{ key: string; anchor: DOMRect } | null>(null)
    const openCard = (key: string, el: HTMLElement) => setCard({ key, anchor: el.getBoundingClientRect() })
    const closeCard = () => setCard(null)
    const cardItem = createMemo(() => {
        const open = card()
        return open ? items().find((i) => i.key === open.key) : undefined
    })

    onMount(() => {
        const onDocDown = (e: PointerEvent) => {
            if (!(e.target as HTMLElement | null)?.closest('.chat-inventory-slot')) closeCard()
        }
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

    const sendTryUse = (item: string, actorId: string) => {
        if (state.isGenerating) return
        if (playback.hasUnread()) {
            toast.info('Finish the scene first.')
            return
        }
        trpc.chat.prompt.mutate({
            message: serializeBlocks([{ type: 'tryUse', what: `item:${item}`, on: `actor:${actorId}` }]),
        })
    }

    const hud = (
        <>
            <div class="chat-hud-actors" ref={bindActorsRail}>
                <div class="chat-hud-actor is-player" data-drop-actor={playerActor()?.customId}>
                    <Show
                        when={playerActor()}
                        fallback={
                            <button
                                class="game-state-actor-micro is-empty"
                                onClick={openPlayerPicker}
                                title="Set player character"
                            >
                                <MdFillPerson size={22} />
                            </button>
                        }
                    >
                        {(p) => (
                            <GameStateActorStatus
                                customId={p().customId}
                                hp={hpOf(p().customId) ?? 100}
                                variant="micro"
                                onClick={openPlayerPicker}
                            />
                        )}
                    </Show>
                </div>

                <For each={npcIds()}>
                    {(customId) => (
                        <div class="chat-hud-actor" data-drop-actor={customId}>
                            <GameStateActorStatus
                                customId={customId}
                                hp={hpOf(customId) ?? 0}
                                variant="micro"
                                onClick={() => openActorStatus(customId)}
                            />
                        </div>
                    )}
                </For>
            </div>

            <Show when={items().length > 0}>
                <div class="chat-hud-divider" />
            </Show>

            <div class="chat-hud-items">
                <For each={items()}>
                    {(item) => {
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
                                    fallback={
                                        <Show
                                            when={isIconPending(item.key)}
                                            fallback={<span class="chat-inventory-slot-emoji">{pickEmojiForItem(item.label)}</span>}
                                        >
                                            <Loader size={22} />
                                        </Show>
                                    }
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
        </>
    )

    return (
        <>
            <div class="chat-status-panel">
                <ChatInput hud={hud} />
            </div>

            <Show when={cardItem()}>
                {(item) => <ItemCard item={item()} anchor={card()!.anchor} />}
            </Show>
        </>
    )
}
