import { createEffect, createSignal, For, on, onCleanup, Show } from 'solid-js'
import { MdFillCheck, MdFillClose } from 'solid-icons/md'
import { rollPassed, type RollRandomBlock as RollRandomBlockType } from '../blocks'
import { state } from '../../../state'

const TUMBLE_MS = 420
const STAGGER_MS = 140
const SPIN_MS = 55

function actorNames(ids: string[]): string {
    const actors = Object.values(state.assets.actors ?? {})
    return ids
        .map(id => actors.find(a => a.customId === id)?.name ?? id)
        .join(' + ')
}

/**
 * The numbers are already decided — they were rolled on the server and stored
 * in the block. The tumble is only a reveal, and it runs once, when playback
 * reaches the block; scrolling back through history shows the settled result.
 */
export function RollRandomBlock(props: {
    block: RollRandomBlockType
    isActive?: boolean
}) {
    const rolls = () => props.block.rolls
    const [spinning, setSpinning] = createSignal<boolean[]>([])
    const [tick, setTick] = createSignal(0)

    const isSpinning = (i: number) => spinning()[i] === true

    createEffect(on(() => props.isActive === true, (active, wasActive) => {
        if (!active || wasActive) return

        setSpinning(rolls().map(() => true))
        const spin = setInterval(() => setTick(t => t + 1), SPIN_MS)
        const settles = rolls().map((_, i) => setTimeout(
            () => setSpinning(s => s.map((v, k) => (k === i ? false : v))),
            TUMBLE_MS + i * STAGGER_MS,
        ))
        const stop = setTimeout(
            () => clearInterval(spin),
            TUMBLE_MS + (rolls().length - 1) * STAGGER_MS,
        )

        onCleanup(() => {
            clearInterval(spin)
            clearTimeout(stop)
            settles.forEach(clearTimeout)
            setSpinning([])
        })
    }))

    return (
        <div class="chat-block chat-block-roll" role="group" aria-label={props.block.title}>
            <div class="chat-block-roll-head">
                <span class="chat-block-roll-rule" aria-hidden="true" />
                <span class="chat-block-roll-title">{props.block.title}</span>
                <span class="chat-block-roll-rule" aria-hidden="true" />
            </div>

            <p class="chat-block-roll-subtitle">{props.block.subtitle}</p>

            <div class="chat-block-roll-tray">
                <For each={rolls()}>
                    {(roll, i) => {
                        const passed = () => rollPassed(roll)
                        const shown = () => {
                            if (!isSpinning(i())) return roll.value
                            tick()
                            return 1 + Math.floor(Math.random() * 100)
                        }
                        return (
                            <div
                                class="chat-block-roll-cell"
                                classList={{
                                    'is-spinning': isSpinning(i()),
                                    'is-pass': !isSpinning(i()) && passed(),
                                    'is-fail': !isSpinning(i()) && !passed(),
                                }}
                                aria-label={`${actorNames(roll.actors)} rolled ${roll.value}, needed above ${roll.threshold}: ${passed() ? 'success' : 'failure'}`}
                            >
                                <span class="chat-block-roll-who">{actorNames(roll.actors)}</span>
                                <span class="chat-block-roll-value">
                                    {shown()}
                                    <Show when={!isSpinning(i())}>
                                        <span class="chat-block-roll-mark" aria-hidden="true">
                                            {passed() ? <MdFillCheck size={16} /> : <MdFillClose size={16} />}
                                        </span>
                                    </Show>
                                </span>
                                <span class="chat-block-roll-need">needs {roll.threshold + 1}+</span>
                            </div>
                        )
                    }}
                </For>
            </div>
        </div>
    )
}
