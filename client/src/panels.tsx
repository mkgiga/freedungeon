import { createSignal, type Accessor, type JSXElement } from 'solid-js'

/**
 * Side panels: things you open beside your work rather than navigate to.
 *
 * A tab replaces what you were looking at; a panel sits next to it. That is the
 * distinction this registry exists to encode — `NAV_ITEMS` is the set of places
 * you can go, and this is the set of things you can have open while you are
 * somewhere. A download in progress is the first: you want to glance at it and
 * carry on, not visit it.
 *
 * Registration is dynamic rather than a static array so a panel can exist only
 * while it has something to say, and so code outside this module — including,
 * eventually, extensions — can contribute one without being edited into a list.
 * Module-level signals rather than a context, matching `tab-state.ts`, so a
 * caller does not have to be mounted under a provider to register.
 */
export type PanelSpec = {
    /** Stable identity. Registering the same id twice replaces the first. */
    id: string
    label: string
    icon: (size?: number) => JSXElement
    /**
     * Short status shown on the button — a percentage, a count. Reactive, so it
     * can track work in flight. Null renders nothing.
     */
    badge?: Accessor<string | number | null>
    /** The panel's body. Rendered only while this panel is the open one. */
    render: () => JSXElement
    /**
     * Lower sorts first. Unset sorts last, so an ad-hoc panel appends rather
     * than pushing its way in among the app's own.
     */
    order?: number
}

const [panels, setPanels] = createSignal<PanelSpec[]>([])
const [openId, setOpenId] = createSignal<string | null>(null)

/** Every registered panel, in display order. */
export const registeredPanels = panels

export const openPanelId = openId

export function openPanel(id: string): void {
    setOpenId(id)
}

export function closePanel(): void {
    setOpenId(null)
}

export function togglePanel(id: string): void {
    setOpenId((cur) => (cur === id ? null : id))
}

/**
 * Add a panel, returning a disposer.
 *
 * The disposer closes the panel if it was the open one — otherwise unregistering
 * while open would leave the host rendering nothing with no way back, which is
 * indistinguishable from a bug.
 */
export function registerPanel(spec: PanelSpec): () => void {
    setPanels((list) => [...list.filter((p) => p.id !== spec.id), spec]
        .sort((a, b) => (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER)))

    return () => {
        setPanels((list) => list.filter((p) => p.id !== spec.id))
        setOpenId((cur) => (cur === spec.id ? null : cur))
    }
}
