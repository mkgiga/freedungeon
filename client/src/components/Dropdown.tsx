import { createSignal, For, Show, onCleanup, type JSXElement } from 'solid-js'
import { Portal } from 'solid-js/web'

export type DropdownItem = {
    label: string
    icon?: JSXElement
    onClick: () => void
    danger?: boolean
    disabled?: boolean
    title?: string
}

const VIEWPORT_MARGIN = 8

/**
 * The floating menu half of a dropdown, anchored to an element you already own.
 *
 * Split out from `Dropdown` because that component supplies its own trigger
 * button, and some triggers can't be wrapped: the speech portrait is
 * `float: left` (the dialogue wraps around it), so an extra container — or an
 * extra button around its button — changes the layout. Here the caller keeps
 * its element and just hands over the rect to hang the menu off.
 */
export function AnchoredMenu(props: {
    anchor: HTMLElement
    items: DropdownItem[]
    onClose: () => void
}) {
    const r = props.anchor.getBoundingClientRect()
    const [pos, setPos] = createSignal({ top: r.bottom + 4, right: window.innerWidth - r.right })
    const [visible, setVisible] = createSignal(false)
    let menuRef: HTMLDivElement | undefined

    const clampToViewport = () => {
        if (!menuRef) return
        const menu = menuRef.getBoundingClientRect()
        const anchorRect = props.anchor.getBoundingClientRect()
        const vw = window.innerWidth
        const vh = window.innerHeight
        const current = pos()

        let top = current.top
        let right = current.right

        if (top + menu.height > vh - VIEWPORT_MARGIN) {
            top = Math.max(VIEWPORT_MARGIN, anchorRect.top - menu.height - 4)
        }

        const leftEdge = vw - right - menu.width
        if (leftEdge < VIEWPORT_MARGIN) {
            right = Math.max(VIEWPORT_MARGIN, vw - menu.width - VIEWPORT_MARGIN)
        }

        setPos({ top, right })
        setVisible(true)
    }

    const handleClickOutside = (e: MouseEvent) => {
        const target = e.target as Node
        if (menuRef?.contains(target)) return
        if (props.anchor.contains(target)) return
        props.onClose()
    }

    const handleKeydown = (e: KeyboardEvent) => {
        if (e.key === 'Escape') props.onClose()
    }

    const handleReposition = () => props.onClose()

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
        <Portal>
            <div
                ref={(el) => {
                    menuRef = el
                    requestAnimationFrame(clampToViewport)
                }}
                class="dropdown-menu dropdown-menu-portal"
                classList={{ 'dropdown-menu-hidden': !visible() }}
                style={{ top: `${pos().top}px`, right: `${pos().right}px` }}
            >
                <For each={props.items}>
                    {(item) => (
                        <button
                            class="dropdown-item"
                            classList={{ 'dropdown-item-danger': item.danger }}
                            disabled={item.disabled}
                            title={item.title}
                            onClick={(e) => {
                                e.stopPropagation()
                                item.onClick()
                                props.onClose()
                            }}
                        >
                            <Show when={item.icon}>{item.icon}</Show>
                            <span>{item.label}</span>
                        </button>
                    )}
                </For>
            </div>
        </Portal>
    )
}

export function Dropdown(props: {
    trigger: JSXElement
    items: DropdownItem[]
}) {
    const [isOpen, setIsOpen] = createSignal(false)
    let triggerRef: HTMLButtonElement | undefined

    const toggle = (e: MouseEvent) => {
        e.stopPropagation()
        setIsOpen((open) => !open)
    }

    return (
        <div class="dropdown-container">
            <button ref={triggerRef} class="dropdown-trigger" onClick={toggle}>
                {props.trigger}
            </button>
            <Show when={isOpen() && triggerRef}>
                {(anchor) => (
                    <AnchoredMenu
                        anchor={anchor()}
                        items={props.items}
                        onClose={() => setIsOpen(false)}
                    />
                )}
            </Show>
        </div>
    )
}
