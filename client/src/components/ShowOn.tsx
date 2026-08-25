import { Show, type JSXElement } from 'solid-js'
import { viewport, type Viewport } from '../viewport'

/**
 * Renders children only on the given viewport sizes.
 *
 *   <ShowOn viewport="phone">…</ShowOn>
 *   <ShowOn viewport={['tablet', 'wide']}>…</ShowOn>
 *
 * Like Solid's `<Show>`, children aren't rendered at all rather than rendered
 * and hidden. Use `md:hidden` when the same markup just looks different, this
 * when the markup itself should differ.
 */
export function ShowOn(props: {
    viewport: Viewport | Viewport[]
    children: JSXElement
    fallback?: JSXElement
}) {
    const matches = () => {
        const allowed = Array.isArray(props.viewport) ? props.viewport : [props.viewport]
        return allowed.includes(viewport())
    }

    return <Show when={matches()} fallback={props.fallback}>{props.children}</Show>
}
