import { createEffect, onMount } from 'solid-js'

/**
 * A contenteditable wrapper that decouples its content from reactive JSX children.
 * Solid's reactivity would otherwise wipe the user's in-progress edits when the
 * bound signal updates. Here, we set `innerText` imperatively via a ref and
 * only sync external changes when the element is not focused.
 */
export function EditableText(props: {
    initial: string
    display?: string
    onCommit: (value: string) => void
    class?: string
    placeholder?: string
}) {
    let el: HTMLDivElement | undefined

    const shown = () => props.display ?? props.initial

    onMount(() => {
        if (el) el.innerText = shown()
    })

    createEffect(() => {
        const text = shown()
        if (el && document.activeElement !== el) {
            el.innerText = text
        }
    })

    return (
        <div
            ref={el}
            class={`editable-text ${props.class ?? ''}`}
            contenteditable="plaintext-only"
            data-placeholder={props.placeholder}
            onFocus={(e) => { e.currentTarget.innerText = props.initial }}
            onBlur={(e) => {
                const value = e.currentTarget.innerText
                if (value !== props.initial) {
                    props.onCommit(value)
                }
                e.currentTarget.innerText = value === props.initial ? shown() : value
            }}
        />
    )
}
