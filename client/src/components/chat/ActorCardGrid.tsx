import { For, Show } from 'solid-js'
import autoAnimate from '@formkit/auto-animate'
import { ImageIcon } from '../ImageIcon'
import { AddNewCard } from '../AddNew'
import { Text } from '../typography/Text'
import type { Actor } from '@shared/types'

/**
 * The cast of a chat or Scenario, as portrait cards. The set is small and
 * hand-picked and what matters is recognising faces, so this trades the Actors
 * screen's sorting and density for portraits.
 */
export function ActorCardGrid(props: {
    actors: Actor[]
    onRemove?: (actor: Actor) => void
    onActorClick?: (actor: Actor) => void
    addNew?: { label: string; onClick: () => void }
    isFlashing?: (actor: Actor) => boolean
    emptyLabel?: string
}) {
    return (
        <Show
            when={props.actors.length > 0 || props.addNew}
            fallback={<Text size="sm" class="opacity-50">{props.emptyLabel ?? 'No actors yet.'}</Text>}
        >
            <div class="actor-card-grid" ref={(el) => autoAnimate(el)}>
                <Show when={props.addNew}>
                    {(add) => <AddNewCard label={add().label} onClick={add().onClick} />}
                </Show>
                <For each={props.actors}>
                    {(actor) => (
                        <div class="actor-card" classList={{ 'is-flashing': props.isFlashing?.(actor) }}>
                            <button
                                type="button"
                                class="actor-card-body"
                                onClick={() => props.onActorClick?.(actor)}
                                title={actor.name}
                            >
                                <ImageIcon url={actor.avatarUrl} size={72} />
                                <Text size="sm" class="actor-card-name">{actor.name}</Text>
                            </button>
                            <Show when={props.onRemove}>
                                <button
                                    type="button"
                                    class="actor-card-remove"
                                    title={`Remove ${actor.name}`}
                                    onClick={() => props.onRemove!(actor)}
                                >
                                    ×
                                </button>
                            </Show>
                        </div>
                    )}
                </For>
            </div>
        </Show>
    )
}
