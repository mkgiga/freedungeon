import { createMemo } from 'solid-js'
import type { WebviewBlock as WebviewBlockType } from '../blocks'

// Scrollbar styling matching the main app. Injected into each sandboxed iframe
// since they get their own document tree and don't inherit parent CSS.
// --text / --primary are redefined locally so the iframe doesn't depend on
// parent variables (sandbox="allow-scripts" but no allow-same-origin).
const IFRAME_SCROLLBAR_CSS = `
  :root {
    --scrollbar-thumb: rgba(210, 210, 210, 0.2);
    --scrollbar-thumb-hover: rgba(210, 210, 210, 0.4);
    --scrollbar-thumb-active: oklch(64.6% 0.14237 253.939);
  }
  html { scrollbar-width: thin; scrollbar-color: var(--scrollbar-thumb) transparent; }
  ::-webkit-scrollbar { width: 8px; height: 8px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb {
    background: var(--scrollbar-thumb);
    border-radius: 4px;
    transition: background 150ms ease;
  }
  ::-webkit-scrollbar-thumb:hover { background: var(--scrollbar-thumb-hover); }
  ::-webkit-scrollbar-thumb:active { background: var(--scrollbar-thumb-active); }
  ::-webkit-scrollbar-corner { background: transparent; }
`

export function WebviewBlock(props: {
    block: WebviewBlockType
    onUpdate: (block: WebviewBlockType) => void
}) {
    const srcDoc = createMemo(() => {
        const userCss = props.block.css ? `<style>${props.block.css}</style>` : ''
        const scrollbarCss = `<style>${IFRAME_SCROLLBAR_CSS}</style>`
        const script = props.block.script ? `<script>${props.block.script}<\/script>` : ''
        // Scrollbar CSS goes first so user CSS can override it if they want.
        return `<!DOCTYPE html><html><head>${scrollbarCss}${userCss}</head><body>${props.block.html}${script}</body></html>`
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
