import type { JSX } from 'solid-js'
import { splitProps } from 'solid-js'
import { useFlip } from '../Flip'

type TextSize = 'sm' | 'base' | 'lg'
type FontStyle = 'sans' | 'serif' | 'mono'

const sizeMap: Record<TextSize, string> = {
    sm: 'text-caption',
    base: 'text-body',
    lg: 'text-lg',
}

const fontMap: Record<FontStyle, string> = {
    sans: 'font-sans',
    serif: 'font-serif',
    mono: 'font-mono',
}

type TextProps = JSX.HTMLAttributes<HTMLParagraphElement> & {
    size?: TextSize
    font?: FontStyle
}

export function Text(props: TextProps) {
    const [local, rest] = splitProps(props, ['size', 'font', 'class', 'style'])
    const flip = useFlip()

    const className = () => [
        sizeMap[local.size ?? 'base'],
        local.font ? fontMap[local.font] : '',
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
        return { ...base, transform: t }
    }

    return <p class={className()} style={mergedStyle()} {...rest} />
}
