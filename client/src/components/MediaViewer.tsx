import { Show, For, splitProps } from 'solid-js'
import { useModal } from './Modal'
import type { Action } from './actions'

type MediaType = 'image' | 'video' | 'audio' | 'unknown'

function detectMediaType(url: string): MediaType {
    const ext = url.split('.').pop()?.split('?')[0]?.toLowerCase() ?? ''
    if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'avif'].includes(ext)) return 'image'
    if (['mp4', 'webm', 'ogg', 'mov', 'avi'].includes(ext)) return 'video'
    if (['mp3', 'wav', 'flac', 'aac', 'ogg'].includes(ext)) return 'audio'
    return 'unknown'
}

function MediaElement(props: { url: string; type?: MediaType }) {
    const mediaType = () => props.type ?? detectMediaType(props.url)

    return (
        <>
            <Show when={mediaType() === 'image'}>
                <img src={props.url} class="media-viewer-content" alt="" />
            </Show>
            <Show when={mediaType() === 'video'}>
                <video src={props.url} class="media-viewer-content" controls />
            </Show>
            <Show when={mediaType() === 'audio'}>
                <audio src={props.url} controls class="w-full" />
            </Show>
            <Show when={mediaType() === 'unknown'}>
                <img src={props.url} class="media-viewer-content" alt="" />
            </Show>
        </>
    )
}

export function useMediaViewer() {
    const modal = useModal()

    const open = (opts: {
        url: string
        title?: string
        type?: MediaType
        actions?: Action[]
    }) => {
        modal.open({
            title: opts.title,
            fullscreen: true,
            content: () => (
                <div class="media-viewer">
                    <div class="media-viewer-stage">
                        <MediaElement url={opts.url} type={opts.type} />
                    </div>
                    <Show when={opts.actions && opts.actions.length > 0}>
                        <div class="media-viewer-actions">
                            <For each={opts.actions}>
                                {(action) => (
                                    <button
                                        class={`modal-btn ${action.danger ? 'modal-btn-danger' : ''}`}
                                        disabled={action.disabled}
                                        onClick={action.onClick}
                                    >
                                        <Show when={action.icon}>{action.icon}</Show>
                                        <span>{action.label}</span>
                                    </button>
                                )}
                            </For>
                        </div>
                    </Show>
                </div>
            ),
        })
    }

    return { open }
}
