import { createSignal, For, Show, onCleanup, type JSXElement } from 'solid-js'
import { Portal } from 'solid-js/web'

export type DropdownItem = {
    label: string
    icon?: JSXElement
    onClick: () => void
    danger?: boolean
}

export function Dropdown(props: {
    trigger: JSXElement
    items: DropdownItem[]
}) {
    const [isOpen, setIsOpen] = createSignal(false)
    // Initial pos is a best-guess based on the trigger; clamped after mount.
    const [pos, setPos] = createSignal<{ top: number; right: number } | null>(null)
    // Hidden during the first layout pass so the user never sees the pre-clamp flash.
    const [visible, setVisible] = createSignal(false)
    let containerRef: HTMLDivElement | undefined
    let menuRef: HTMLDivElement | undefined
    let triggerRef: HTMLButtonElement | undefined

    const VIEWPORT_MARGIN = 8

    const close = () => {
        setIsOpen(false)
        setVisible(false)
    }

    const open = () => {
        if (!triggerRef) return
        const r = triggerRef.getBoundingClientRect()
        setPos({ top: r.bottom + 4, right: window.innerWidth - r.right })
        setVisible(false)
        setIsOpen(true)
    }

    const toggle = (e: MouseEvent) => {
        e.stopPropagation()
        if (isOpen()) close()
        else open()
    }

    // After the menu mounts we know its real size — clamp it inside the viewport,
    // flipping above the trigger if it would overflow the bottom.
    const clampToViewport = () => {
        if (!menuRef || !triggerRef) return
        const menu = menuRef.getBoundingClientRect()
        const triggerRect = triggerRef.getBoundingClientRect()
        const vw = window.innerWidth
        const vh = window.innerHeight
        const current = pos()
        if (!current) return

        let top = current.top
        let right = current.right

        // Vertical: if the menu would overflow the bottom, flip above the trigger.
        if (top + menu.height > vh - VIEWPORT_MARGIN) {
            top = Math.max(VIEWPORT_MARGIN, triggerRect.top - menu.height - 4)
        }

        // Horizontal: right-anchored; if the menu's left edge would overflow,
        // slide it rightward to keep it on-screen.
        const leftEdge = vw - right - menu.width
        if (leftEdge < VIEWPORT_MARGIN) {
            right = Math.max(VIEWPORT_MARGIN, vw - menu.width - VIEWPORT_MARGIN)
        }

        setPos({ top, right })
        setVisible(true)
    }

    const handleClickOutside = (e: MouseEvent) => {
        const target = e.target as Node
        const insideContainer = containerRef?.contains(target)
        const insideMenu = menuRef?.contains(target)
        if (!insideContainer && !insideMenu) close()
    }

    const handleKeydown = (e: KeyboardEvent) => {
        if (e.key === 'Escape') close()
    }

    const handleReposition = () => { if (isOpen()) close() }

    document.addEventListener('click', handleClickOutside)
    document.addEventListener('keydown', handleKeydown)
    window.addEventListener('scroll', handleReposition, true)
    window.addEventListener('resize', handleReposition)
    onCleanup(() => {
        document.removeEventListener('click', handleClickOutside)
        document.removeEventListener('keydown', handleKeydown)
        window.removeEventListener('scroll', handleReposition, true)
        window.removeEventListener('resize', handleReposition)
    })

    return (
        <div ref={containerRef} class="dropdown-container">
            <button ref={triggerRef} class="dropdown-trigger" onClick={toggle}>
                {props.trigger}
            </button>
            <Show when={isOpen() && pos()}>
                <Portal>
                    <div
                        ref={(el) => {
                            menuRef = el
                            // Menu is in the DOM now — measure on the next frame so
                            // styles are settled, then clamp + reveal.
                            requestAnimationFrame(clampToViewport)
                        }}
                        class="dropdown-menu dropdown-menu-portal"
                        classList={{ 'dropdown-menu-hidden': !visible() }}
                        style={{ top: `${pos()!.top}px`, right: `${pos()!.right}px` }}
                    >
                        <For each={props.items}>
                            {(item) => (
                                <button
                                    class={`dropdown-item ${item.danger ? 'dropdown-item-danger' : ''}`}
                                    onClick={(e) => {
                                        e.stopPropagation()
                                        item.onClick()
                                        close()
                                    }}
                                >
                                    <Show when={item.icon}>{item.icon}</Show>
                                    <span>{item.label}</span>
                                </button>
                            )}
                        </For>
                    </div>
                </Portal>
            </Show>
        </div>
    )
}
