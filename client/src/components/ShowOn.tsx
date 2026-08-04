import { Show, type JSXElement } from 'solid-js'
import { viewport, type Viewport } from '../viewport'

/**
 * Renders children only on the given viewport sizes.
 *
 *   <ShowOn viewport="phone">…</ShowOn>
 *   <ShowOn viewport={['tablet', 'wide']}>…</ShowOn>
 *
 * Named to sit next to Solid's own `<Show>`, and it behaves the same way:
 * children aren't rendered at all when the condition is false, rather than
 * rendered and hidden. That's the reason to use this over a `md:hidden` class —
 * reach for CSS when the same markup just looks different, and this when the
 * markup itself should differ.
 */
export function ShowOn(props: {
    viewport: Viewport | Viewport[]
    children: JSXElement
    /** Rendered on the sizes that don't match. */
    fallback?: JSXElement
}) {
    const matches = () => {
        const allowed = Array.isArray(props.viewport) ? props.viewport : [props.viewport]
        return allowed.includes(viewport())
    }

    return <Show when={matches()} fallback={props.fallback}>{props.children}</Show>
}
