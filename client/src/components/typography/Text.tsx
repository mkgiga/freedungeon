import type { JSX } from 'solid-js'
import { splitProps } from 'solid-js'

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
    const [local, rest] = splitProps(props, ['size', 'font', 'class'])

    const className = () => [
        sizeMap[local.size ?? 'base'],
        local.font ? fontMap[local.font] : '',
        local.class ?? '',
    ].filter(Boolean).join(' ')

    return <p class={className()} {...rest} />
}
