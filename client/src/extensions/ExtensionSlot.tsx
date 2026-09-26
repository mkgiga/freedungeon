import { For, onCleanup } from 'solid-js'
import type { UiSlot } from '@shared/extensions'
import { slotContributions } from './host'
import { state } from '../state'
import { resolveExtensionConfig } from '@shared/extensions'

/**
 * Where extensions are allowed to draw. Renders nothing at all when nobody has
 * claimed the slot, so a layout keeps its own spacing rules - an empty slot
 * must not leave a gap.
 */
export function ExtensionSlot(props: { name: UiSlot; only?: string; class?: string }) {
    const items = () => slotContributions(props.name, props.only)

    return (
        <For each={items()}>
            {(item) => {
                const bind = (el: HTMLDivElement) => {
                    const info = state.extensions?.[item.id]
                    const teardown = item.mount(el, {
                        slot: props.name,
                        get settings() {
                            return resolveExtensionConfig(
                                info?.settings ?? [],
                                state.userPreferences.extensions?.[item.id],
                            ).values
                        },
                    })
                    onCleanup(() => {
                        try { teardown?.() } catch (err) {
                            console.warn(`[ext:${item.id}] slot teardown threw`, err)
                        }
                        el.replaceChildren()
                    })
                }
                return <div class={props.class ?? 'extension-slot'} data-extension={item.id} ref={bind} />
            }}
        </For>
    )
}
