import { createMemo, For, Show } from 'solid-js'
import { state } from '../../state'
import { ImageIcon } from '../ImageIcon'
import { useModal } from '../Modal'
import { GameStateActorStatus } from '../GameStateActorStatus'
import { PlayerCharacterPicker } from './AssetPicker'
import { pickEmojiForItem } from './inventory/itemEmoji'
import { usePlayback } from './playback'
import { MdFillPerson } from 'solid-icons/md'

/**
 * The persistent bottom band, repurposed from the old input panel into a
 * game-state HUD: present actors (player + NPCs) on top, the player's inventory
 * as a horizontally-scrollable strip of slots below. The composer now lives
 * inline at the end of the message feed (see ChatInput).
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

    const playerHp = () => {
        const p = playerActor()
        if (!p) return null
        return playback.effectiveGameState().scene.actors.active[p.customId]?.hp ?? null
    }

    // Active actors minus the player, sorted avatar-first then by name — same
    // ordering the topbar used before these chips moved down here.
    const npcs = createMemo(() => {
        const playerCustomId = playerActor()?.customId
        return Object.entries(playback.effectiveGameState().scene.actors.active)
            .filter(([customId]) => customId !== playerCustomId)
            .sort(([idA], [idB]) => {
                const hasAvatarA = Boolean(state.assets.actors[idA]?.avatarUrl?.length)
                const hasAvatarB = Boolean(state.assets.actors[idB]?.avatarUrl?.length)
                if (hasAvatarA !== hasAvatarB) return hasAvatarA ? -1 : 1
                return resolveActorName(idA).localeCompare(resolveActorName(idB))
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

    const openActorStatus = (customId: string, hp: number) => {
        modal.open({
            title: resolveActorName(customId),
            content: () => <GameStateActorStatus customId={customId} hp={hp} variant="presentation" />,
        })
    }

    return (
        <div class="chat-status-panel">
            <div class="chat-status-actors">
                <Show
                    when={playerActor()}
                    fallback={
                        <button class="chat-status-set-player" onClick={openPlayerPicker} title="Set player character">
                            <MdFillPerson size={20} />
                        </button>
                    }
                >
                    {(p) => (
                        <div class="chat-status-player">
                            <Show
                                when={playerHp() != null}
                                fallback={
                                    <button class="chat-status-player-avatar" onClick={openPlayerPicker} title="Change player character">
                                        <ImageIcon url={p().avatarUrl} />
                                    </button>
                                }
                            >
                                <GameStateActorStatus
                                    customId={p().customId}
                                    hp={playerHp()!}
                                    variant="small"
                                    onClick={openPlayerPicker}
                                />
                            </Show>
                        </div>
                    )}
                </Show>

                <For each={npcs()}>
                    {([customId, actorState]) => (
                        <GameStateActorStatus
                            customId={customId}
                            hp={actorState.hp}
                            variant="small"
                            onClick={() => openActorStatus(customId, actorState.hp)}
                        />
                    )}
                </For>
            </div>

            <div class="chat-status-inventory">
                <For each={items()} fallback={<span class="chat-status-inventory-empty">Inventory empty</span>}>
                    {([name, qty]) => (
                        <div class="chat-inventory-slot" title={`${name}${qty > 1 ? ` ×${qty}` : ''}`}>
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
