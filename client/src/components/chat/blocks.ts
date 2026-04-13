// ── Block types ──

export type TextBlock = { type: 'text'; content: string; icon?: string }
export type SpeechBlock = {
    type: 'speech'
    actorId?: string
    name?: string
    dialogue: string
    expression?: string
}
export type PauseBlock = { type: 'pause'; seconds: number }
export type ImageBlock = { type: 'image'; src: string; from: string; caption?: string }
export type WebviewBlock = { type: 'webview'; html: string; css?: string; script?: string }
export type UnformattedBlock = { type: 'unformatted'; content: string }

export type Block =
    | TextBlock
    | SpeechBlock
    | PauseBlock
    | ImageBlock
    | WebviewBlock
    | UnformattedBlock

// ── Parser ──

export function parseBlocks(content: string): Block[] {
    const blocks: Block[] = []

    const api = {
        text: (c: string, opts?: { icon?: string }) => {
            blocks.push({ type: 'text', content: c, ...(opts?.icon ? { icon: opts.icon } : {}) })
        },
        speech: (...args: any[]) => {
            if (typeof args[1] === 'string') {
                // speech(actorId, dialogue, opts?)
                const [actorId, dialogue, opts] = args as [string, string, { name?: string; expression?: string } | undefined]
                blocks.push({
                    type: 'speech',
                    actorId,
                    dialogue,
                    ...(opts?.name ? { name: opts.name } : {}),
                    ...(opts?.expression ? { expression: opts.expression } : {}),
                })
            } else {
                // speech(dialogue, { name })
                const [dialogue, opts] = args as [string, { name: string }]
                blocks.push({
                    type: 'speech',
                    dialogue,
                    name: opts?.name,
                })
            }
        },
        pause: (seconds: number) => {
            blocks.push({ type: 'pause', seconds })
        },
        image: (opts: { src: string; from: string; caption?: string }) => {
            blocks.push({ type: 'image', src: opts.src, from: opts.from, ...(opts.caption ? { caption: opts.caption } : {}) })
        },
        webview: (html: string, opts?: { css?: string; script?: string }) => {
            blocks.push({
                type: 'webview',
                html,
                ...(opts?.css ? { css: opts.css } : {}),
                ...(opts?.script ? { script: opts.script } : {}),
            })
        },
        unformatted: (c: string) => {
            blocks.push({ type: 'unformatted', content: c })
        },
    }

    if (!content || !content.trim()) return blocks

    try {
        const keys = Object.keys(api)
        const values = Object.values(api)
        // eslint-disable-next-line no-new-func
        const fn = new Function(...keys, content)
        fn(...values)
    } catch (e) {
        console.error('Failed to parse blocks', e, '\ncontent:', content)
    }

    return blocks
}

// ── Serializer ──

function escapeTemplate(s: string): string {
    return s.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${')
}

function escapeString(s: string): string {
    return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

function tpl(s: string): string {
    return `\`${escapeTemplate(s)}\``
}

function str(s: string): string {
    return `"${escapeString(s)}"`
}

export function serializeBlocks(blocks: Block[]): string {
    return blocks
        .filter((b) => {
            // Empty text/speech blocks would round-trip as `text("");` / `speech("", "")`
            // and re-render as empty blocks forever. Dropping them lets the user
            // delete a block by blanking its contenteditable.
            if (b.type === 'text') return b.content.trim() !== ''
            if (b.type === 'speech') return b.dialogue.trim() !== ''
            return true
        })
        .map((b) => {
            switch (b.type) {
                case 'text': {
                    const opts = b.icon ? `, { icon: ${str(b.icon)} }` : ''
                    return `text(${tpl(b.content)}${opts});`
                }
                case 'speech': {
                    const dialogue = tpl(b.dialogue)
                    if (b.actorId) {
                        const optsParts: string[] = []
                        if (b.name) optsParts.push(`name: ${str(b.name)}`)
                        if (b.expression) optsParts.push(`expression: ${str(b.expression)}`)
                        const opts = optsParts.length ? `, { ${optsParts.join(', ')} }` : ''
                        return `speech(${str(b.actorId)}, ${dialogue}${opts});`
                    }
                    return `speech(${dialogue}, { name: ${str(b.name ?? '')} });`
                }
                case 'pause':
                    return `pause(${b.seconds});`
                case 'image': {
                    const parts = [`src: ${str(b.src)}`, `from: ${str(b.from)}`]
                    if (b.caption) parts.push(`caption: ${str(b.caption)}`)
                    return `image({ ${parts.join(', ')} });`
                }
                case 'webview': {
                    const optsParts: string[] = []
                    if (b.css) optsParts.push(`css: ${tpl(b.css)}`)
                    if (b.script) optsParts.push(`script: ${tpl(b.script)}`)
                    const opts = optsParts.length ? `, { ${optsParts.join(', ')} }` : ''
                    return `webview(${tpl(b.html)}${opts});`
                }
                case 'unformatted':
                    return `unformatted(${tpl(b.content)});`
            }
        })
        .join('\n')
}
