import type { JSX, JSXElement } from 'solid-js'
import { splitProps } from 'solid-js'
import { useFlip } from '../Flip'

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
    const [local, rest] = splitProps(props, ['type', 'bold', 'semibold', 'italic', 'underline', 'strike', 'class', 'children', 'style'])
    const flip = useFlip()

    const className = () => [
        local.type ? emphasisMap[local.type] : 'text-emphasis',
        local.semibold ? 'font-semibold' : '',
        local.class ?? '',
    ].filter(Boolean).join(' ')

    const counterTransform = () => {
        const h = flip.horizontal, v = flip.vertical
        if (h && v) return 'scale(-1, -1)'
        if (h) return 'scaleX(-1)'
        if (v) return 'scaleY(-1)'
        return undefined
    }

    const mergedStyle = () => {
        const t = counterTransform()
        if (!t) return local.style
        const base = typeof local.style === 'object' && local.style !== null ? local.style : {}
        return { ...base, transform: t, display: 'inline-block' }
    }

    return (() => {
        let result: JSXElement = <span class={className()} style={mergedStyle()} {...rest}>{local.children}</span>
        if (local.strike) result = <s>{result}</s>
        if (local.underline) result = <u>{result}</u>
        if (local.italic) result = <em>{result}</em>
        if (local.bold) result = <strong>{result}</strong>
        return result
    })()
}
