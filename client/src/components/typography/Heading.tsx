import type { JSX } from 'solid-js'
import { splitProps } from 'solid-js'

type HeadingLevel = 1 | 2 | 3 | 4

type HeadingProps = JSX.HTMLAttributes<HTMLHeadingElement> & {
    level?: HeadingLevel
}

export function Heading(props: HeadingProps) {
    const [local, rest] = splitProps(props, ['level'])

    return (() => {
        switch (local.level ?? 2) {
            case 1: return <h1 {...rest} />
            case 2: return <h2 {...rest} />
            case 3: return <h3 {...rest} />
            case 4: return <h4 {...rest} />
        }
    })()
}
