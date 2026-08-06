import { createEffect, onMount } from 'solid-js'

/**
 * A contenteditable wrapper that decouples its content from reactive JSX children.
 * Solid's reactivity would otherwise wipe the user's in-progress edits when the
 * bound signal updates. Here, we set `innerText` imperatively via a ref and
 * only sync external changes when the element is not focused.
 */
export function EditableText(props: {
    initial: string
    /**
     * What to show while not focused, when that differs from the source —
     * `<@actor_id>` mentions rendered as names, say. Focusing swaps back to
     * `initial` so edits are always made against the real text; without that,
     * committing would bake the resolved form in permanently.
     */
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

    // External changes sync only when not focused
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
                // Nothing to re-render against if the value didn't change, so
                // restore the display form by hand.
                e.currentTarget.innerText = value === props.initial ? shown() : value
            }}
        />
    )
}
