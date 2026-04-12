import { MdFillQuestion_mark } from "solid-icons/md"
import { createEffect, createSignal, on, Show, splitProps, type JSX } from "solid-js"
import { Loader } from "./Loader"

type ImageIconProps = JSX.HTMLAttributes<HTMLDivElement> & {
    url?: string
    size?: number
    placeholder?: JSX.Element
}

export function ImageIcon(props: ImageIconProps) {
    const [local, rest] = splitProps(props, ['size', 'url', 'class', 'placeholder'])
    const size = () => local.size ?? 40
    const placeholder = () => local.placeholder ?? <MdFillQuestion_mark size={size()} />

    const className = () => [
        'image-icon',
        local.class,
    ].filter(Boolean).join(' ')

    const [status, setStatus] = createSignal<'idle' | 'loading' | 'loaded' | 'error'>(
        local.url ? 'loading' : 'idle'
    )

    // Reset status when url changes
    createEffect(on(() => local.url, (url) => {
        setStatus(url ? 'loading' : 'idle')
    }, { defer: true }))

    return (
        <div class={className()} style={{ width: `${size()}px`, height: `${size()}px` }} {...rest}>
            <Show when={local.url} fallback={placeholder()}>
                <Show when={status() === 'loaded'} fallback={
                    <Show when={status() !== 'error'} fallback={placeholder()}>
                        <Loader size={size() * 0.5} />
                    </Show>
                }>
                    <img src={local.url} class="image-icon-img" alt="" />
                </Show>
                {/* Hidden preloader */}
                <img
                    src={local.url}
                    style={{ display: 'none' }}
                    onLoad={() => setStatus('loaded')}
                    onError={() => setStatus('error')}
                />
            </Show>
        </div>
    )
}
