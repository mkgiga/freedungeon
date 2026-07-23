import { createEffect, createMemo, createSignal, For, onMount, Show, untrack } from 'solid-js'
import autoAnimate from '@formkit/auto-animate'
import { state } from '../../state'
import { trpc } from '../../trpc'
import { useModal } from '../Modal'
import { GameStateActorStatus } from '../GameStateActorStatus'
import { PlayerCharacterPicker } from './AssetPicker'
import { pickEmojiForItem } from './inventory/itemEmoji'
import { usePlayback } from './playback'
import { serializeBlocks } from './blocks'
import { startItemDrag } from './itemDrag'
import { MdFillPerson } from 'solid-icons/md'

/**
 * The persistent bottom band, repurposed from the old input panel into a
 * game-state HUD: present actors (player + NPCs) as small vertical cards on the
 * left, the player's inventory as a 2-column grid on the right. The composer
 * now lives inline at the end of the message feed (see ChatInput).
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

    const items = createMemo(() =>
        Object.entries(playback.effectiveGameState().inventory ?? {})
            .filter(([, qty]) => qty > 0)
            .sort(([a], [b]) => a.localeCompare(b))
    )

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

    let actorsRef: HTMLDivElement | undefined
    onMount(() => {
        if (actorsRef) autoAnimate(actorsRef)
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
        <div class="chat-status-panel">
            <div class="chat-status-actors" ref={actorsRef}>
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

            <div class="chat-status-inventory">
                <For each={items()} fallback={<span class="chat-status-inventory-empty">Inventory empty</span>}>
                    {([name, qty]) => (
                        <div
                            class="chat-inventory-slot"
                            title={`${name}${qty > 1 ? ` ×${qty}` : ''}`}
                            onPointerDown={(e) => {
                                if (state.isGenerating) return
                                startItemDrag(e, e.currentTarget, (actorId) => sendTryUse(name, actorId))
                            }}
                        >
                            <span class="chat-inventory-slot-emoji">{pickEmojiForItem(name)}</span>
                            <Show when={qty > 1}>
                                <span class="chat-inventory-slot-qty">{qty}</span>
                            </Show>
                        </div>
                    )}
                </For>
            </div>
        </div>
    )
}
