/**
 * Viewport size as reactive state, for the cases CSS can't cover — rendering
 * genuinely different markup rather than restyling the same markup.
 *
 * The thresholds deliberately match Tailwind's `md` (768px) and `lg` (1024px),
 * which the app already uses in class names, so a `md:hidden` and a
 * `<ShowOn viewport="phone">` can never disagree about where the line is.
 *
 * Driven by matchMedia rather than a resize listener: the browser evaluates the
 * query itself and only notifies on an actual crossing, so there's no
 * per-pixel event storm to throttle.
 */

import { createSignal, onCleanup } from 'solid-js'

export type Viewport = 'phone' | 'tablet' | 'wide'

/** Tailwind md — below this is a phone. */
const TABLET_MIN = 768
/** Tailwind lg — at or above this is a widescreen layout. */
const WIDE_MIN = 1024

const tabletQuery = `(min-width: ${TABLET_MIN}px)`
const wideQuery = `(min-width: ${WIDE_MIN}px)`

function measure(): Viewport {
    if (typeof window === 'undefined') return 'phone'
    if (window.matchMedia(wideQuery).matches) return 'wide'
    if (window.matchMedia(tabletQuery).matches) return 'tablet'
    return 'phone'
}

const [viewport, setViewport] = createSignal<Viewport>(measure())

/**
 * Retained deliberately. A MediaQueryList with no live reference can be
 * garbage collected along with its listener, at which point the signal silently
 * stops updating and the layout is frozen at whatever it measured on load —
 * which is what happened before this array existed. Holding them at module
 * scope keeps the subscriptions alive for the life of the page.
 */
const watched: MediaQueryList[] = []

// Module-level listeners: the value is global, so one subscription serves every
// consumer rather than one per component.
if (typeof window !== 'undefined') {
    const update = () => setViewport(measure())
    for (const q of [tabletQuery, wideQuery]) {
        const mql = window.matchMedia(q)
        mql.addEventListener('change', update)
        watched.push(mql)
    }
}

export { viewport }

/** True when the viewport is any of the given sizes. */
export function isViewport(...sizes: Viewport[]): boolean {
    return sizes.includes(viewport())
}

/**
 * Subscribe to an arbitrary media query. Not used by the breakpoints above —
 * this is for one-off queries a component owns, and it cleans up with the
 * component.
 */
export function createMediaQuery(query: string): () => boolean {
    const mql = window.matchMedia(query)
    const [matches, setMatches] = createSignal(mql.matches)
    const update = (e: MediaQueryListEvent) => setMatches(e.matches)
    mql.addEventListener('change', update)
    onCleanup(() => mql.removeEventListener('change', update))
    return matches
}
