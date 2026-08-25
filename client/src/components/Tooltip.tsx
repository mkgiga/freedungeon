import {
    createContext, createEffect, createSignal, onCleanup, onMount, useContext, Show,
    type JSXElement,
} from 'solid-js'
import { Portal } from 'solid-js/web'
import { MdOutlineInfo } from 'solid-icons/md'

export type TooltipPlacement = 'top' | 'bottom' | 'left' | 'right'

export type TooltipConfig = {
    content: () => JSXElement
    anchor: DOMRect
    placement?: TooltipPlacement
}

type TooltipAPI = {
    show: (owner: object, config: TooltipConfig) => void
    hide: (owner?: object) => void
    isShowing: (owner: object) => boolean
}

const TooltipContext = createContext<TooltipAPI>()

export function useTooltip(): TooltipAPI {
    const ctx = useContext(TooltipContext)
    if (!ctx) throw new Error('useTooltip must be used within <TooltipProvider>')
    return ctx
}

const GAP = 8
const MARGIN = 8
const FALLBACKS: Record<TooltipPlacement, TooltipPlacement[]> = {
    top: ['top', 'bottom', 'right', 'left'],
    bottom: ['bottom', 'top', 'right', 'left'],
    left: ['left', 'right', 'top', 'bottom'],
    right: ['right', 'left', 'top', 'bottom'],
}

const clamp = (value: number, min: number, max: number) =>
    Math.min(Math.max(value, min), Math.max(min, max))

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
 * Fit is judged on the measured box, so a tooltip near an edge flips. If no
 * side fits, the preferred one is clamped rather than moved off screen.
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

export function TooltipProvider(props: { children: JSXElement }) {
    const [current, setCurrent] = createSignal<{ owner: object; config: TooltipConfig } | null>(null)
    const [pos, setPos] = createSignal({ top: 0, left: 0 })
    const [side, setSide] = createSignal<TooltipPlacement>('bottom')
    const [visible, setVisible] = createSignal(false)
    let boxRef: HTMLDivElement | undefined

    const api: TooltipAPI = {
        show: (owner, config) => setCurrent({ owner, config }),
        hide: (owner) => setCurrent(c => (!owner || c?.owner === owner) ? null : c),
        isShowing: (owner) => current()?.owner === owner,
    }

    createEffect(() => {
        const t = current()
        if (!t) return

        setVisible(false)
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

export function InfoTooltip(props: {
    children: JSXElement
    placement?: TooltipPlacement
    trigger?: JSXElement
    size?: number
}) {
    const tooltip = useTooltip()
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
