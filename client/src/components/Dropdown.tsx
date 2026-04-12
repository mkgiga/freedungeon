import { createSignal, For, Show, onCleanup, type JSXElement } from 'solid-js'

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
    let containerRef: HTMLDivElement | undefined

    const toggle = (e: MouseEvent) => {
        e.stopPropagation()
        setIsOpen(!isOpen())
    }

    const close = () => setIsOpen(false)

    const handleClickOutside = (e: MouseEvent) => {
        if (containerRef && !containerRef.contains(e.target as Node)) {
            close()
        }
    }

    const handleKeydown = (e: KeyboardEvent) => {
        if (e.key === 'Escape') close()
    }

    document.addEventListener('click', handleClickOutside)
    document.addEventListener('keydown', handleKeydown)
    onCleanup(() => {
        document.removeEventListener('click', handleClickOutside)
        document.removeEventListener('keydown', handleKeydown)
    })

    return (
        <div ref={containerRef} class="dropdown-container">
            <button class="dropdown-trigger" onClick={toggle}>
                {props.trigger}
            </button>
            <Show when={isOpen()}>
                <div class="dropdown-menu">
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
            </Show>
        </div>
    )
}
