import type { JSX, JSXElement } from 'solid-js'
import { splitProps } from 'solid-js'

export type EmphasisType = 'primary' | 'muted' | 'danger' | 'success' | 'warning'

const emphasisMap: Record<EmphasisType, string> = {
    primary: 'text-emphasis',
    muted: 'text-emphasis-muted',
    danger: 'text-emphasis-danger',
    success: 'text-emphasis-success',
    warning: 'text-emphasis-warning',
}

type EmProps = JSX.HTMLAttributes<HTMLSpanElement> & {
    type?: EmphasisType
    bold?: boolean
    semibold?: boolean
    italic?: boolean
    underline?: boolean
    strike?: boolean
}

export function Em(props: EmProps) {
    const [local, rest] = splitProps(props, ['type', 'bold', 'semibold', 'italic', 'underline', 'strike', 'class', 'children'])

    const className = () => [
        local.type ? emphasisMap[local.type] : 'text-emphasis',
        local.semibold ? 'font-semibold' : '',
        local.class ?? '',
    ].filter(Boolean).join(' ')

    return (() => {
        let result: JSXElement = <span class={className()} {...rest}>{local.children}</span>
        if (local.strike) result = <s>{result}</s>
        if (local.underline) result = <u>{result}</u>
        if (local.italic) result = <em>{result}</em>
        if (local.bold) result = <strong>{result}</strong>
        return result
    })()
}
