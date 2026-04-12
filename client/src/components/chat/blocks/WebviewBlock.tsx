import { createMemo } from 'solid-js'
import type { WebviewBlock as WebviewBlockType } from '../blocks'

export function WebviewBlock(props: {
    block: WebviewBlockType
    onUpdate: (block: WebviewBlockType) => void
}) {
    const srcDoc = createMemo(() => {
        const css = props.block.css ? `<style>${props.block.css}</style>` : ''
        const script = props.block.script ? `<script>${props.block.script}<\/script>` : ''
        return `<!DOCTYPE html><html><head>${css}</head><body>${props.block.html}${script}</body></html>`
    })

    return (
        <div class="chat-block chat-block-webview">
            <iframe
                srcdoc={srcDoc()}
                sandbox="allow-scripts"
                title="Webview block"
            />
        </div>
    )
}
