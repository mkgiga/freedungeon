
import { createSignal, onCleanup } from 'solid-js'

export type Viewport = 'phone' | 'tablet' | 'wide'

const TABLET_MIN = 768
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

const watched: MediaQueryList[] = []

if (typeof window !== 'undefined') {
    const update = () => setViewport(measure())
    for (const q of [tabletQuery, wideQuery]) {
        const mql = window.matchMedia(q)
        mql.addEventListener('change', update)
        watched.push(mql)
    }
}

export { viewport }

export function isViewport(...sizes: Viewport[]): boolean {
    return sizes.includes(viewport())
}

export function createMediaQuery(query: string): () => boolean {
    const mql = window.matchMedia(query)
    const [matches, setMatches] = createSignal(mql.matches)
    const update = (e: MediaQueryListEvent) => setMatches(e.matches)
    mql.addEventListener('change', update)
    onCleanup(() => mql.removeEventListener('change', update))
    return matches
}
