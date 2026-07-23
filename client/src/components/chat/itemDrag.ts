/**
 * Pointer-based drag-and-drop for inventory items — deliberately not HTML5
 * drag-and-drop (no styling control over the native ghost, no touch support).
 *
 * On pointerdown over a slot, nothing happens until the pointer moves past a
 * small threshold (so incidental presses stay inert). Then:
 *   - a fixed-position container is created at the source element's exact
 *     bounds, holding a deep clone of it, and follows the pointer via
 *     transform (pointer-events: none, so it never blocks hit-testing)
 *   - the source element gets `.drag-source-ghost`
 *   - <body> gets `.item-dragging`, which surfaces every `[data-drop-actor]`
 *     element as a visible target via CSS
 *   - each move hit-tests document.elementFromPoint for the nearest
 *     `[data-drop-actor]` ancestor and marks it with `.drop-target-hover`
 *
 * Releasing over a target calls `onDrop(actorId)`; releasing anywhere else
 * (or pointercancel / Escape-less abort paths) just cleans up.
 */
export function startItemDrag(
    down: PointerEvent,
    sourceEl: HTMLElement,
    onDrop: (actorId: string) => void,
) {
    if (!down.isPrimary || down.button !== 0) return

    const startX = down.clientX
    const startY = down.clientY
    const THRESHOLD = 5

    let overlay: HTMLDivElement | null = null
    let hoverTarget: HTMLElement | null = null

    const beginDrag = () => {
        const rect = sourceEl.getBoundingClientRect()
        overlay = document.createElement('div')
        overlay.className = 'item-drag-overlay'
        overlay.style.left = `${rect.left}px`
        overlay.style.top = `${rect.top}px`
        overlay.style.width = `${rect.width}px`
        overlay.style.height = `${rect.height}px`
        overlay.appendChild(sourceEl.cloneNode(true))
        document.body.appendChild(overlay)
        sourceEl.classList.add('drag-source-ghost')
        document.body.classList.add('item-dragging')
    }

    const moveOverlay = (e: PointerEvent) => {
        if (!overlay) return
        overlay.style.transform =
            `translate(${e.clientX - startX}px, ${e.clientY - startY}px) scale(1.1)`
    }

    const updateHover = (e: PointerEvent) => {
        const el = document.elementFromPoint(e.clientX, e.clientY)
        const target = (el?.closest('[data-drop-actor]') ?? null) as HTMLElement | null
        if (target === hoverTarget) return
        hoverTarget?.classList.remove('drop-target-hover')
        hoverTarget = target
        hoverTarget?.classList.add('drop-target-hover')
    }

    const cleanup = () => {
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
        window.removeEventListener('pointercancel', cleanup)
        overlay?.remove()
        overlay = null
        hoverTarget?.classList.remove('drop-target-hover')
        hoverTarget = null
        sourceEl.classList.remove('drag-source-ghost')
        document.body.classList.remove('item-dragging')
    }

    const onMove = (e: PointerEvent) => {
        if (!overlay) {
            if (Math.hypot(e.clientX - startX, e.clientY - startY) < THRESHOLD) return
            beginDrag()
        }
        moveOverlay(e)
        updateHover(e)
    }

    const onUp = () => {
        const actorId = hoverTarget?.dataset.dropActor
        cleanup()
        if (actorId) onDrop(actorId)
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', cleanup)
}
