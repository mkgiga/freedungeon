import {
    createContext, createEffect, createSignal, onCleanup, onMount, useContext, Show,
    type JSXElement,
} from 'solid-js'
import { Portal } from 'solid-js/web'
import { MdOutlineInfo } from 'solid-icons/md'

// ── Types ──

export type TooltipPlacement = 'top' | 'bottom' | 'left' | 'right'

export type TooltipConfig = {
    content: () => JSXElement
    /** Where to point. Usually a trigger's getBoundingClientRect(). */
    anchor: DOMRect
    /** Tried first; the tooltip falls back to whichever side actually fits. */
    placement?: TooltipPlacement
}

type TooltipAPI = {
    /** `owner` identifies the caller so it can hide only its own tooltip. */
    show: (owner: object, config: TooltipConfig) => void
    hide: (owner?: object) => void
    isShowing: (owner: object) => boolean
}

// ── Context ──

const TooltipContext = createContext<TooltipAPI>()

export function useTooltip(): TooltipAPI {
    const ctx = useContext(TooltipContext)
    if (!ctx) throw new Error('useTooltip must be used within <TooltipProvider>')
    return ctx
}

// ── Positioning ──

const GAP = 8
const MARGIN = 8
/** Fallback order per preferred side — first one that fits wins. */
const FALLBACKS: Record<TooltipPlacement, TooltipPlacement[]> = {
    top: ['top', 'bottom', 'right', 'left'],
    bottom: ['bottom', 'top', 'right', 'left'],
    left: ['left', 'right', 'top', 'bottom'],
    right: ['right', 'left', 'top', 'bottom'],
}

const clamp = (value: number, min: number, max: number) =>
    Math.min(Math.max(value, min), Math.max(min, max))

/** Top-left for `box` on `side` of `anchor`, before any clamping. */
function offer(side: TooltipPlacement, anchor: DOMRect, box: { width: number; height: number }) {
    switch (side) {
        case 'top':
            return { top: anchor.top - box.height - GAP, left: anchor.left + anchor.width / 2 - box.width / 2 }
        case 'bottom':
            return { top: anchor.bottom + GAP, left: anchor.left + anchor.width / 2 - box.width / 2 }
        case 'left':
            return { top: anchor.top + anchor.height / 2 - box.height / 2, left: anchor.left - box.width - GAP }
        case 'right':
            return { top: anchor.top + anchor.height / 2 - box.height / 2, left: anchor.right + GAP }
    }
}

/**
 * Pick a side that fits, then keep the box on screen.
 *
 * Fit is judged on the *measured* box, so a tooltip near an edge flips rather
 * than being shoved back over its own trigger. If no side fits (a small
 * viewport, a long tooltip) the preferred one is used and clamped — overlapping
 * the trigger beats hanging off the screen.
 */
export function placeTooltip(
    anchor: DOMRect,
    box: { width: number; height: number },
    preferred: TooltipPlacement,
    viewport: { width: number; height: number },
) {
    const fits = (p: { top: number; left: number }) =>
        p.top >= MARGIN &&
        p.left >= MARGIN &&
        p.top + box.height <= viewport.height - MARGIN &&
        p.left + box.width <= viewport.width - MARGIN

    const order = FALLBACKS[preferred]
    const side = order.find(s => fits(offer(s, anchor, box))) ?? preferred
    const pos = offer(side, anchor, box)

    return {
        side,
        top: clamp(pos.top, MARGIN, viewport.height - box.height - MARGIN),
        left: clamp(pos.left, MARGIN, viewport.width - box.width - MARGIN),
    }
}

// ── Provider ──

export function TooltipProvider(props: { children: JSXElement }) {
    const [current, setCurrent] = createSignal<{ owner: object; config: TooltipConfig } | null>(null)
    const [pos, setPos] = createSignal({ top: 0, left: 0 })
    const [side, setSide] = createSignal<TooltipPlacement>('bottom')
    // Hidden for the first layout pass: the box has to be in the DOM to be
    // measured, and an unplaced tooltip flashing at the wrong spot is worse
    // than one frame of nothing.
    const [visible, setVisible] = createSignal(false)
    let boxRef: HTMLDivElement | undefined

    const api: TooltipAPI = {
        show: (owner, config) => setCurrent({ owner, config }),
        hide: (owner) => setCurrent(c => (!owner || c?.owner === owner) ? null : c),
        isShowing: (owner) => current()?.owner === owner,
    }

    // Re-runs whenever the tooltip changes — including swapping straight from
    // one trigger to another, where the element is reused and no ref fires.
    createEffect(() => {
        const t = current()
        if (!t) return

        setVisible(false)
        // Park it at the anchor so measurement happens at roughly the final
        // width; a box measured mid-viewport can wrap differently.
        const placement = t.config.placement ?? 'bottom'
        setSide(placement)
        setPos({ top: t.config.anchor.bottom + GAP, left: t.config.anchor.left })

        requestAnimationFrame(() => {
            if (!boxRef || current() !== t) return
            const box = boxRef.getBoundingClientRect()
            const placed = placeTooltip(
                t.config.anchor,
                { width: box.width, height: box.height },
                placement,
                { width: window.innerWidth, height: window.innerHeight },
            )
            setSide(placed.side)
            setPos({ top: placed.top, left: placed.left })
            setVisible(true)
        })
    })

    const dismiss = () => api.hide()
    const onKeydown = (e: KeyboardEvent) => { if (e.key === 'Escape') dismiss() }

    onMount(() => {
        // Capture phase: a tooltip should go away even if the thing underneath
        // stops the event.
        document.addEventListener('keydown', onKeydown)
        window.addEventListener('scroll', dismiss, true)
        window.addEventListener('resize', dismiss)
    })
    onCleanup(() => {
        document.removeEventListener('keydown', onKeydown)
        window.removeEventListener('scroll', dismiss, true)
        window.removeEventListener('resize', dismiss)
    })

    return (
        <TooltipContext.Provider value={api}>
            {props.children}
            <Show when={current()}>
                {(tooltip) => (
                    <Portal>
                        <div
                            ref={boxRef}
                            class={`tooltip tooltip-${side()}`}
                            classList={{ 'tooltip-hidden': !visible() }}
                            role="tooltip"
                            style={{ top: `${pos().top}px`, left: `${pos().left}px` }}
                        >
                            {tooltip().config.content()}
                        </div>
                    </Portal>
                )}
            </Show>
        </TooltipContext.Provider>
    )
}

// ── Trigger ──

/**
 * An ⓘ that explains something on hover, and stays put when clicked.
 *
 * Hover alone is unusable on a touchscreen and awkward if the text is long
 * enough to want re-reading, so a click pins the tooltip until it's dismissed.
 */
export function InfoTooltip(props: {
    children: JSXElement
    placement?: TooltipPlacement
    /** Replaces the ⓘ glyph. */
    trigger?: JSXElement
    size?: number
}) {
    const tooltip = useTooltip()
    // Identity only — never rendered.
    const owner = {}
    const [pinned, setPinned] = createSignal(false)
    let ref: HTMLButtonElement | undefined

    const open = () => {
        if (!ref) return
        tooltip.show(owner, {
            content: () => props.children,
            anchor: ref.getBoundingClientRect(),
            placement: props.placement,
        })
    }

    const close = () => {
        setPinned(false)
        tooltip.hide(owner)
    }

    // The provider drops the tooltip on Escape/scroll without telling us, so a
    // stale `pinned` would make the next click a no-op.
    createEffect(() => {
        if (pinned() && !tooltip.isShowing(owner)) setPinned(false)
    })

    onCleanup(() => tooltip.hide(owner))

    return (
        <button
            ref={ref}
            type="button"
            class="info-tooltip-trigger"
            aria-label="More information"
            onMouseEnter={open}
            onMouseLeave={() => { if (!pinned()) tooltip.hide(owner) }}
            onFocus={open}
            onBlur={() => { if (!pinned()) tooltip.hide(owner) }}
            onClick={(e) => {
                e.stopPropagation()
                if (pinned()) close()
                else { setPinned(true); open() }
            }}
        >
            <Show when={props.trigger} fallback={<MdOutlineInfo size={props.size ?? 16} />}>
                {props.trigger}
            </Show>
        </button>
    )
}
