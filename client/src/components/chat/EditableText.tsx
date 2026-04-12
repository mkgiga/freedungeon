import { createEffect, onMount } from 'solid-js'

/**
 * A contenteditable wrapper that decouples its content from reactive JSX children.
 * Solid's reactivity would otherwise wipe the user's in-progress edits when the
 * bound signal updates. Here, we set `innerText` imperatively via a ref and
 * only sync external changes when the element is not focused.
 */
export function EditableText(props: {
    initial: string
    onCommit: (value: string) => void
    class?: string
    placeholder?: string
}) {
    let el: HTMLDivElement | undefined

    onMount(() => {
        if (el) el.innerText = props.initial
    })

    // External changes sync only when not focused
    createEffect(() => {
        const text = props.initial
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
            onBlur={(e) => {
                const value = e.currentTarget.innerText
                if (value !== props.initial) {
                    props.onCommit(value)
                }
            }}
        />
    )
}
