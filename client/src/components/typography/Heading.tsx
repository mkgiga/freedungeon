import type { JSX } from 'solid-js'
import { splitProps } from 'solid-js'
import { useFlip } from '../Flip'

type HeadingLevel = 1 | 2 | 3 | 4

type HeadingProps = JSX.HTMLAttributes<HTMLHeadingElement> & {
    level?: HeadingLevel
}

export function Heading(props: HeadingProps) {
    const [local, rest] = splitProps(props, ['level', 'style'])
    const flip = useFlip()

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

    return (() => {
        switch (local.level ?? 2) {
            case 1: return <h1 style={mergedStyle()} {...rest} />
            case 2: return <h2 style={mergedStyle()} {...rest} />
            case 3: return <h3 style={mergedStyle()} {...rest} />
            case 4: return <h4 style={mergedStyle()} {...rest} />
        }
    })()
}
