import { Match, Show, Switch, type JSXElement } from 'solid-js'
import { state } from '../state'
import { ImageIcon } from './ImageIcon'
import { Heading } from './typography/Heading'
import { Text } from './typography/Text'
import { Flip } from './Flip'

type Variant = 'compact' | 'small' | 'presentation'

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

    console.log(description());

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

                <Match when={props.variant === 'small'}>
                    <Flip horizontal>
                        <div class="flex items-center">
                            <ImageIcon url={avatarUrl()} size={props.avatarSize ?? 60} />
                            <div class="flex flex-col min-w-0 flex-1 h-full">
                                <div class="flex flex-col items-start h-full justify-end">
                                    <Text size="sm" class="opacity-70">{props.hp}/{maxHp()}</Text>
                                    <div class="hp-bar hp-bar-horizontal">
                                        <div class="hp-bar-fill" style={{ width: `${pct()}%` }} />
                                    </div>
                                </div>
                                <Text size="sm" class="truncate">{displayName()}</Text>
                            </div>
                        </div>
                    </Flip>
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
                            <span class=''>{description()}</span>
                        </Show>
                    </div>
                </Match>
            </Switch>
        </div>
    )
}
