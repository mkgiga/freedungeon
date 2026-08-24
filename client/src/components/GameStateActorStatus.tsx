import { Match, Show, Switch, type JSXElement } from 'solid-js'
import { state } from '../state'
import { ImageIcon } from './ImageIcon'
import { Heading } from './typography/Heading'
import { Text } from './typography/Text'

type Variant = 'compact' | 'presentation' | 'micro'

type Props = {
    customId: string
    hp: number
    variant: Variant
    maxHp?: number
    onClick?: () => void
    avatarSize?: number
}

export function GameStateActorStatus(props: Props): JSXElement {
    const actor = () => Object.values(state.assets.actors).find(a => a.customId === props.customId) ?? null
    const displayName = () => actor()?.name ?? props.customId
    const avatarUrl = () => actor()?.avatarUrl
    const description = () => actor()?.description ?? ''
    const maxHp = () => props.maxHp ?? 100
    const pct = () => Math.max(0, Math.min(100, (props.hp / maxHp()) * 100))

    return (
        <div class="game-state-actor-status contents">
            <Switch>
                <Match when={props.variant === 'compact'}>
                    <button
                        type="button"
                        class="game-state-actor-compact"
                        onClick={props.onClick}
                        aria-label={`${displayName()} — HP ${props.hp}/${maxHp()}`}
                    >
                        <div class="game-state-actor-compact-avatar">
                            <ImageIcon url={avatarUrl()} />
                        </div>
                        <div class="hp-bar hp-bar-horizontal">
                            <div class="hp-bar-fill" style={{ width: `${pct()}%` }} />
                        </div>
                        <span class="game-state-actor-compact-hp">{props.hp}</span>
                    </button>
                </Match>

                {/* Square avatar, nothing else — it sits in the composer rail
                  * beside the inventory, where a name and a numeric HP would
                  * cost more width than the whole rail has. The orb carries the
                  * health: outline always drawn so the actor's full capacity
                  * stays visible, fill rising from the bottom. */}
                <Match when={props.variant === 'micro'}>
                    <button
                        type="button"
                        class="game-state-actor-micro"
                        onClick={props.onClick}
                        title={`${displayName()} — HP ${props.hp}/${maxHp()}`}
                        aria-label={`${displayName()} — HP ${props.hp}/${maxHp()}`}
                    >
                        <ImageIcon url={avatarUrl()} size={props.avatarSize ?? 40} />
                        <span class="hp-orb">
                            <span class="hp-orb-fill" style={{ height: `${pct()}%` }} />
                        </span>
                    </button>
                </Match>

                <Match when={props.variant === 'presentation'}>
                    <div class="game-state-actor-presentation">
                        <div class="flex items-center gap-4">
                            <ImageIcon url={avatarUrl()} size={props.avatarSize ?? 80} />
                            <Heading level={2}>{displayName()}</Heading>
                        </div>
                        <div class="flex flex-col gap-2">
                            <Text size="sm">HP {props.hp}/{maxHp()}</Text>
                            <div class="hp-bar hp-bar-horizontal">
                                <div class="hp-bar-fill" style={{ width: `${pct()}%` }} />
                            </div>
                        </div>
                        <Show when={description()}>
                            {/* Descriptions are authored as multi-line text; without
                              * pre-wrap the newlines collapse into spaces. */}
                            <Text size="sm" class="whitespace-pre-wrap">{description()}</Text>
                        </Show>
                    </div>
                </Match>
            </Switch>
        </div>
    )
}
