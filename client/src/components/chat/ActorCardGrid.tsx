import { For, Show } from 'solid-js'
import autoAnimate from '@formkit/auto-animate'
import { ImageIcon } from '../ImageIcon'
import { AddNewCard } from '../AddNew'
import { Text } from '../typography/Text'
import type { Actor } from '@shared/types'

/**
 * The cast of a chat or Scenario, as portrait cards.
 *
 * A sortable table is the right tool for browsing hundreds of actors, which is
 * what the Actors screen does. Here the set is small and hand-picked, and what
 * matters is recognising faces at a glance — so this trades sorting and density
 * for portraits.
 */
export function ActorCardGrid(props: {
    actors: Actor[]
    /** Called when a card's remove control is used. */
    onRemove?: (actor: Actor) => void
    onActorClick?: (actor: Actor) => void
    /** Renders the add affordance as the first card. See components/AddNew. */
    addNew?: { label: string; onClick: () => void }
    /** Pulses a card that just changed. Ordering is the caller's job. */
    isFlashing?: (actor: Actor) => boolean
    emptyLabel?: string
}) {
    return (
        <Show
            // The add-new card is content in its own right, so an otherwise
            // empty grid isn't empty — falling back to "no actors yet" would
            // hide the only thing there is to press.
            when={props.actors.length > 0 || props.addNew}
            fallback={<Text size="sm" class="opacity-50">{props.emptyLabel ?? 'No actors yet.'}</Text>}
        >
            {/* Same treatment as the party rail: cards slide to their new
                position instead of teleporting when the order changes. */}
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
