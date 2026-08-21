import { Show } from 'solid-js'
import { MdFillClose } from 'solid-icons/md'
import { closePanel, openPanelId, registeredPanels } from '../panels'
import { viewport } from '../viewport'
import { Heading } from './typography/Heading'

/**
 * Where an open side panel is rendered.
 *
 * Deliberately part of the layout rather than floating above it. A panel that
 * overlays the page can always end up on top of the one thing the user needed
 * to see, and the only fix for that is not doing it: on a wide screen the host
 * is a column that narrows the content, and on a phone it takes the content
 * area outright while the nav bar stays put. Either way nothing is hidden
 * behind it, and closing restores exactly what was there.
 */
export function PanelHost() {
    const open = () => registeredPanels().find((p) => p.id === openPanelId()) ?? null

    return (
        <Show when={open()}>
            {(panel) => (
                <aside class="panel-host" classList={{ 'is-phone': viewport() === 'phone' }}>
                    <header class="panel-host-header">
                        <Heading level={3} class="panel-host-title">{panel().label}</Heading>
                        <button type="button" class="panel-host-close" title="Close" onClick={closePanel}>
                            <MdFillClose size={20} />
                        </button>
                    </header>
                    <div class="panel-host-body">{panel().render()}</div>
                </aside>
            )}
        </Show>
    )
}
