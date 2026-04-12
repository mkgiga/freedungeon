import type { JSX } from 'solid-js'
import { splitProps } from 'solid-js'

type LoaderProps = JSX.HTMLAttributes<HTMLDivElement> & {
    size?: number
}

export function Loader(props: LoaderProps) {
    const [local, rest] = splitProps(props, ['size', 'class'])
    const s = () => local.size ?? 24

    return (
        <div
            class={`loader ${local.class ?? ''}`}
            style={{ width: `${s()}px`, height: `${s()}px` }}
            {...rest}
        >
            <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3" stroke-linecap="round" opacity="0.25" />
                <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" stroke-width="3" stroke-linecap="round" />
            </svg>
        </div>
    )
}
