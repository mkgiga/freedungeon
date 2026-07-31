// ── Block types ──

export type TextBlock = { type: 'text'; content: string }
export type SpeechBlock = {
    type: 'speech'
    actorId?: string
    name?: string
    dialogue: string
    expression?: string
}
export type PauseBlock = { type: 'pause'; seconds: number }
// `aspect` is only set by generate_image, and only describes the shape the
// image was rendered at — the feed lays the block out from it (and reserves the
// box before the image loads). Gallery images have none and size to their file.
export type ImageBlock = {
    type: 'image'
    src: string
    from: string
    caption?: string
    aspect?: 'square' | 'landscape' | 'portrait'
}
export type WebviewBlock = { type: 'webview'; html: string; css?: string; script?: string }
export type UnformattedBlock = { type: 'unformatted'; content: string }
export type NoOpContinueBlock = { type: 'noOpContinue' }
export type EnterActorsBlock = { type: 'enterActors'; actors: string[] }
export type LeaveActorsBlock = { type: 'leaveActors'; actors: string[] }
export type SetHpBlock = { type: 'setHp'; actorId: string; value: number }
export type DamageBlock = { type: 'damage'; actorId: string; amount: number }
export type HealBlock = { type: 'heal'; actorId: string; amount: number }
// `name` is the item's inventory key: a defineItem `key` for content written
// since item definitions existed, or free-text display name in older chats.
// Both resolve through the same lookup, so legacy content replays unchanged.
export type GiveItemBlock = { type: 'giveItem'; name: string; qty: number }
export type TakeItemBlock = { type: 'takeItem'; name: string; qty: number }
// A persisting item definition. Like every other block this is replayed from
// history rather than stored as a row — `icon` is a URL into /uploads, already
// generated and written to disk by the time the block is serialized.
// Redefining the same key overwrites (last write wins).
export type DefineItemBlock = {
    type: 'defineItem'
    key: string
    label: string
    description?: string
    /** Long-form appearance used as the icon prompt; never rendered. */
    visualDescription?: string
    icon?: string
}
export type SetFlagBlock = { type: 'setFlag'; key: string; value: import('./types').FlagValue }
export type ClearFlagBlock = { type: 'clearFlag'; key: string }
export type SetLocationBlock = { type: 'setLocation'; description: string }
// The agent's optional end-of-turn multiple-choice menu.
export type ChoicePromptBlock = { type: 'choicePrompt'; options: string[] }
// A user's pick from a ChoicePromptBlock — distinct from a free-typed
// `unformatted` action so renderer and agent can tell a menu pick apart.
export type ChoiceBlock = { type: 'choice'; text: string }
// A user's mechanical attempt to use something on something, produced by
// drag-and-drop in the HUD (not typed text). `what`/`on` are prefixed refs
// ("item:Potion", "actor:vega") so the format can later cover other source
// and target kinds. An attempt, not an outcome — the agent adjudicates it
// via the `use_item` tool.
export type TryUseBlock = { type: 'tryUse'; what: string; on: string }
// The agent's adjudicated outcome of a use attempt: consumes qty of the item
// from the party inventory. Item effects are separate follow-up blocks.
export type UseItemBlock = { type: 'useItem'; item: string; target: string; qty: number }

export type Block =
    // Rendering commands
    | TextBlock
    | SpeechBlock
    | PauseBlock
    | ImageBlock
    | WebviewBlock
    | UnformattedBlock
    | NoOpContinueBlock
    // State-mutating commands
    | EnterActorsBlock
    | LeaveActorsBlock
    | SetHpBlock
    | DamageBlock
    | HealBlock
    | DefineItemBlock
    | GiveItemBlock
    | TakeItemBlock
    | UseItemBlock
    | SetFlagBlock
    | ClearFlagBlock
    | SetLocationBlock
    // Choice flow
    | ChoicePromptBlock
    | ChoiceBlock
    // Drag-and-drop use attempt
    | TryUseBlock

// ── Blocking semantics (visual-novel-style playback) ──

/**
 * Block types that pause the playback queue. The frontend renders blocks one
 * at a time during the initial play of a newly-arrived assistant turn; on
 * encountering a blocking block it stops until the user advances. All other
 * block types apply their effects and let playback continue.
 */
export const BLOCKING_BLOCK_TYPES = new Set<Block['type']>(['text', 'speech', 'pause'])

export function isBlockingBlock(b: Block): boolean {
    return BLOCKING_BLOCK_TYPES.has(b.type)
}


// ── Parser ──

// Parse results are deterministic per content string, and message content is
// immutable (edits produce a new string via serializeBlocks), so results are
// cached. Callers must treat the returned Block[] as read-only — mutating a
// block in place would corrupt the cache for every other reader.
// FIFO eviction (drop oldest insertion) rather than clear-on-overflow: a full
// clear right at the cap thrashes when one chat's message count is near it,
// forcing complete re-parses on every replay.
const parseCache = new Map<string, Block[]>()
const PARSE_CACHE_MAX = 50_000

export function parseBlocks(content: string): Block[] {
    const cached = parseCache.get(content)
    if (cached) return cached

    const blocks: Block[] = []

    const api = {
        text: (c: string) => {
            blocks.push({ type: 'text', content: c })
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
        image: (opts: { src: string; from: string; caption?: string; aspect?: ImageBlock['aspect'] }) => {
            blocks.push({
                type: 'image',
                src: opts.src,
                from: opts.from,
                ...(opts.caption ? { caption: opts.caption } : {}),
                ...(opts.aspect ? { aspect: opts.aspect } : {}),
            })
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
        noOpContinue: () => {
            blocks.push({ type: 'noOpContinue' })
        },
        enterActors: (actors: Array<string>) => {
            blocks.push({ type: 'enterActors', actors })
        },
        leaveActors: (actors: Array<string>) => {
            blocks.push({ type: 'leaveActors', actors })
        },
        setHp: (actorId: string, value: number) => {
            blocks.push({ type: 'setHp', actorId, value })
        },
        damage: (actorId: string, amount: number) => {
            blocks.push({ type: 'damage', actorId, amount })
        },
        heal: (actorId: string, amount: number) => {
            blocks.push({ type: 'heal', actorId, amount })
        },
        defineItem: (opts: { key: string; label: string; description?: string; visualDescription?: string; icon?: string }) => {
            blocks.push({
                type: 'defineItem',
                key: opts.key,
                label: opts.label,
                ...(opts.description ? { description: opts.description } : {}),
                ...(opts.visualDescription ? { visualDescription: opts.visualDescription } : {}),
                ...(opts.icon ? { icon: opts.icon } : {}),
            })
        },
        giveItem: (name: string, qty: number) => {
            blocks.push({ type: 'giveItem', name, qty })
        },
        takeItem: (name: string, qty: number) => {
            blocks.push({ type: 'takeItem', name, qty })
        },
        useItem: (item: string, target: string, qty: number = 1) => {
            blocks.push({ type: 'useItem', item, target, qty })
        },
        setFlag: (key: string, value: string | number | boolean) => {
            blocks.push({ type: 'setFlag', key, value })
        },
        clearFlag: (key: string) => {
            blocks.push({ type: 'clearFlag', key })
        },
        setLocation: (description: string) => {
            blocks.push({ type: 'setLocation', description })
        },
        choicePrompt: (options: Array<string>) => {
            blocks.push({ type: 'choicePrompt', options })
        },
        choice: (text: string) => {
            blocks.push({ type: 'choice', text })
        },
        tryUse: (opts: { what: string; on: string }) => {
            blocks.push({ type: 'tryUse', what: opts.what, on: opts.on })
        },
        // No-op parity with createScope (shared/game-state/scope.ts) so legacy
        // content calling attack() doesn't abort the parse mid-message.
        attack: (_target: string) => {},
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

    if (parseCache.size >= PARSE_CACHE_MAX) {
        parseCache.delete(parseCache.keys().next().value!)
    }
    parseCache.set(content, blocks)
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
                case 'text':
                    return `text(${tpl(b.content)});`
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
                    if (b.aspect) parts.push(`aspect: ${str(b.aspect)}`)
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
                case 'noOpContinue':
                    return `noOpContinue();`
                case 'damage':
                    return `damage(${str(b.actorId)}, ${b.amount});`
                case 'heal':
                    return `heal(${str(b.actorId)}, ${b.amount});`
                case 'enterActors':
                    return `enterActors([${b.actors.map(str).join(', ')}]);`
                case 'leaveActors':
                    return `leaveActors([${b.actors.map(str).join(', ')}]);`
                case 'setHp':
                    return `setHp(${str(b.actorId)}, ${b.value});`
                case 'defineItem': {
                    const parts = [`key: ${str(b.key)}`, `label: ${str(b.label)}`]
                    if (b.description) parts.push(`description: ${str(b.description)}`)
                    // Template literal, not a quoted string: a paragraph of
                    // appearance notes routinely contains newlines, which a
                    // double-quoted JS string can't hold — the block would fail
                    // to re-parse on replay.
                    if (b.visualDescription) parts.push(`visualDescription: ${tpl(b.visualDescription)}`)
                    if (b.icon) parts.push(`icon: ${str(b.icon)}`)
                    return `defineItem({ ${parts.join(', ')} });`
                }
                case 'giveItem':
                    return `giveItem(${str(b.name)}, ${b.qty});`
                case 'takeItem':
                    return `takeItem(${str(b.name)}, ${b.qty});`
                case 'useItem':
                    return `useItem(${str(b.item)}, ${str(b.target)}, ${b.qty});`
                case 'setFlag': {
                    const v = typeof b.value === 'string' ? str(b.value) : String(b.value)
                    return `setFlag(${str(b.key)}, ${v});`
                }
                case 'clearFlag':
                    return `clearFlag(${str(b.key)});`
                case 'setLocation':
                    return `setLocation(${str(b.description)});`
                case 'choicePrompt':
                    return `choicePrompt([${b.options.map(str).join(', ')}]);`
                case 'choice':
                    return `choice(${tpl(b.text)});`
                case 'tryUse':
                    return `tryUse({ what: ${str(b.what)}, on: ${str(b.on)} });`
            }
        })
        .filter(Boolean)
        .join('\n')
}
