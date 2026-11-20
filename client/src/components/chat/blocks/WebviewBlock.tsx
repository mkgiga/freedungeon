import { createMemo, createSignal, onCleanup, onMount } from 'solid-js'
import { WEBVIEW_WIDTH } from '@shared/game-state/commands'
import type { WebviewBlock as WebviewBlockType } from '../blocks'

const IFRAME_BASE_CSS = `
  html { background: transparent; }
  body { margin: 0; background: transparent; }
`

/**
 * The frame is sandboxed without allow-same-origin, so it has an opaque origin
 * and the page cannot reach into it to measure anything. The content measures
 * itself instead and posts the number out.
 *
 * It reports body's own border-box height rather than any scrollHeight: a
 * scrollHeight is at least the viewport's, so feeding it back as the frame
 * height would ratchet upward and never come back down.
 */
const MEASURE_SCRIPT = `
  (function () {
    var last = -1
    function report() {
      var h = Math.ceil(document.body.getBoundingClientRect().height)
      if (h === last) return
      last = h
      parent.postMessage({ __webviewHeight: h }, '*')
    }
    new ResizeObserver(report).observe(document.body)
    addEventListener('load', report)
    document.fonts && document.fonts.ready.then(report)
    report()
  })()
`

export function WebviewBlock(props: {
    block: WebviewBlockType
    onUpdate: (block: WebviewBlockType) => void
}) {
    const [contentHeight, setContentHeight] = createSignal(0)
    const [available, setAvailable] = createSignal(WEBVIEW_WIDTH)

    let hostEl: HTMLDivElement | undefined
    let frameEl: HTMLIFrameElement | undefined

    const srcDoc = createMemo(() => {
        const userCss = props.block.css ? `<style>${props.block.css}</style>` : ''
        const script = props.block.script ? `<script>${props.block.script}<\/script>` : ''
        return `<!DOCTYPE html><html><head><style>${IFRAME_BASE_CSS}</style>${userCss}</head>`
            + `<body>${props.block.html}${script}<script>${MEASURE_SCRIPT}<\/script></body></html>`
    })

    // Only ever down. Giving a wide screen a magnified frame would just blur it.
    const scale = () => Math.min(1, available() / WEBVIEW_WIDTH)

    onMount(() => {
        const onMessage = (e: MessageEvent) => {
            if (e.source !== frameEl?.contentWindow) return
            const h = (e.data as { __webviewHeight?: unknown })?.__webviewHeight
            if (typeof h === 'number' && h >= 0) setContentHeight(h)
        }
        window.addEventListener('message', onMessage)

        const ro = new ResizeObserver(([entry]) => {
            const w = entry?.contentRect.width ?? 0
            if (w > 0) setAvailable(w)
        })
        if (hostEl) ro.observe(hostEl)

        onCleanup(() => {
            window.removeEventListener('message', onMessage)
            ro.disconnect()
        })
    })

    return (
        <div class="chat-block chat-block-webview" ref={hostEl}>
            <div class="chat-block-webview-stage" style={{ height: `${contentHeight() * scale()}px` }}>
                <iframe
                    ref={frameEl}
                    srcdoc={srcDoc()}
                    sandbox="allow-scripts"
                    title="Webview block"
                    scrolling="no"
                    style={{
                        width: `${WEBVIEW_WIDTH}px`,
                        height: `${contentHeight()}px`,
                        transform: `scale(${scale()})`,
                    }}
                />
            </div>
        </div>
    )
}
