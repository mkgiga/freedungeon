import path from 'path'
import fs from 'fs'
import { state } from "./server"
import { getCurrentTurnResult } from "./game-state"
import { featureEnabled, resolveFeatureConfig, DEFAULT_STYLE_PREFERENCE } from "@shared/features"
import { sceneImagesEnabled } from "./item-icons"
import { getEmbeddedPrompts } from "./embedded"

const promptsDir = path.join(import.meta.dirname, 'prompts')

type RegistryEntry =
    | { kind: 'fn'; fn: (args: Record<string, unknown>) => string }
    | { kind: 'template'; body: string }

class EvalContext {
    stack = new Set<string>()
    depth = 0
    args: Record<string, unknown> = {}
    scopes: Record<string, unknown> = {}

    features: Record<string, unknown> = {}

    static readonly MAX_DEPTH = 256

    enter(name: string): boolean {
        if (this.stack.has(name)) return false
        this.stack.add(name)
        return true
    }

    exit(name: string) {
        this.stack.delete(name)
    }

    bumpDepth() {
        if (++this.depth > EvalContext.MAX_DEPTH) {
            throw new Error(`Macro expansion depth exceeded (>${EvalContext.MAX_DEPTH})`)
        }
    }

    popDepth() {
        this.depth--
    }
}

const registry = new Map<string, RegistryEntry>()

registry.set('ACTORS', { kind: 'fn', fn: () => {
    const currentChat = state.currentChat
    if (!currentChat) return 'No current chat'

    const resObject: Record<string, { name: string; description: string; expressions: string[] }> = {}
    const playerCharacterId = state.userPreferences.playerCharacterId

    for (const id of currentChat.assets.actors) {
        const actor = state.assets.actors[id]
        if (!actor) continue
        const customId = actor.customId || String(actor.id)
        if (actor.id === playerCharacterId) continue
        resObject[customId] = {
            name: actor.name,
            description: actor.description,
            expressions: Object.keys(actor.expressions),
        }
    }

    if (playerCharacterId !== null) {
        const pc = state.assets.actors[playerCharacterId]
        if (pc) {
            const customId = pc.customId || String(pc.id)
            resObject[customId] = {
                name: pc.name,
                description: pc.description,
                expressions: Object.keys(pc.expressions),
            }
        }
    }

    return JSON.stringify(resObject, null, 2)
} })

registry.set('NOTES', { kind: 'fn', fn: () => {
    const currentChat = state.currentChat
    if (!currentChat) return 'No current chat'

    const result: Array<{ type: string; content: string }> = []
    for (const [id, ref] of Object.entries(currentChat.assets.notes)) {
        if (!ref.enabled) continue
        const note = state.assets.notes[id]
        if (!note) continue
        result.push({ type: note.type, content: note.content })
    }
    return JSON.stringify(result, null, 2)
} })

registry.set('GAME_STATE', { kind: 'fn', fn: () => {
    return getCurrentTurnResult()?.systemPromptGameState ?? '';
} });

/**
 * Gated on `enableChoicePrompts`, same as the tool itself, so the agent is
 * never told about a capability it doesn't have.
 */
export const MULTICHOICE_PROMPT_INSTRUCTIONS = `# 【Choice Prompts】

When you call \`end_turn\`, you may pass a \`choices\` array — an enumerated set of 2+ candidate next actions salient to the focus actor at this branch point. Enumerate them only when the branch genuinely narrows to a few distinct, material actions; otherwise leave the next move open, as usual. The focus actor's controller may select one — it returns next tick as \`choice("...")\` rather than \`unformatted("...")\` — or disregard the set entirely and supply any other action. A selection is the focus actor's action; treat it exactly as the equivalent \`unformatted(...)\` input. Never assume the controller is bound to the enumerated set.`

registry.set('MULTICHOICE_PROMPT_INSTRUCTIONS', { kind: 'fn', fn: () => {
    return featureEnabled(state.userPreferences, 'choicePrompts') ? MULTICHOICE_PROMPT_INSTRUCTIONS : ''
} });

export const IMAGE_GENERATION_INSTRUCTIONS = `# 【Generated Images】

You can render an image into the story with \`generate_image\`. Pass a \`description\` written for an image model — subject and action, setting, framing and camera angle, lighting, mood, colour, in concrete visual nouns; it knows nothing of the story, so name what is in frame rather than who it is to the plot. Pass an \`aspect\` of "landscape" (establishing shots, vistas), "portrait" (a figure, a tall space) or "square", and optionally \`caption\` text to sit beneath the image.

The image is generated on the spot and the turn blocks until it is done, so spend it where a visual does work prose would not: arriving somewhere the party has never seen, a reveal whose look carries the beat. At most one per beat, and never as decoration for a moment you have already described well.`

registry.set('IMAGE_GENERATION_INSTRUCTIONS', { kind: 'fn', fn: () => {
    return sceneImagesEnabled() ? IMAGE_GENERATION_INSTRUCTIONS : ''
} });

type ScopeBuilder = () => unknown

const scopeBuilders = new Map<string, ScopeBuilder>()

/** Middle segments are dropped: "Ada B. Lovelace" -> Ada, Lovelace. */
function splitName(name: string): { firstName: string; lastName: string } {
    const parts = name.trim().split(/\s+/).filter(p => p.length > 0)
    return {
        firstName: parts[0] ?? '',
        lastName: parts.length > 1 ? parts[parts.length - 1]! : '',
    }
}

scopeBuilders.set('player', () => {
    const playerCharacterId = state.userPreferences.playerCharacterId
    if (playerCharacterId === null) return null
    const pc = state.assets.actors[playerCharacterId]
    if (!pc) return null
    return {
        id: pc.customId || pc.id,
        name: pc.name,
        ...splitName(pc.name),
        description: pc.description,
        expressions: Object.keys(pc.expressions),
    }
})

let currentItemDescription = ''

export function withItemDescription<T>(description: string, fn: () => T): T {
    const prev = currentItemDescription
    currentItemDescription = description
    try {
        return fn()
    } finally {
        currentItemDescription = prev
    }
}

scopeBuilders.set('mcp_item_description', () => currentItemDescription)

let currentImagePrompt = ''

export function withImagePrompt<T>(prompt: string, fn: () => T): T {
    const prev = currentImagePrompt
    currentImagePrompt = prompt
    try {
        return fn()
    } finally {
        currentImagePrompt = prev
    }
}

scopeBuilders.set('agent_image_prompt', () => currentImagePrompt)

scopeBuilders.set('user_style_preference', () => {
    const cfg = resolveFeatureConfig('imageGen', state.userPreferences.features?.['imageGen'])
    const style = String((cfg.values as { stylePreference?: unknown }).stylePreference ?? '').trim()
    return style || DEFAULT_STYLE_PREFERENCE
})

export function loadMacroFiles() {
    const embedded = getEmbeddedPrompts()
    if (embedded) {
        const decoder = new TextDecoder()
        for (const [file, bytes] of embedded) {
            if (!file.endsWith('.macro')) continue
            const name = path.basename(file, '.macro')
            registry.set(name, { kind: 'template', body: decoder.decode(bytes) })
        }
        return
    }

    if (!fs.existsSync(promptsDir)) {
        fs.mkdirSync(promptsDir, { recursive: true })
        return
    }
    const files = fs.readdirSync(promptsDir).filter(f => f.endsWith('.macro'))
    for (const file of files) {
        const name = path.basename(file, '.macro')
        const body = fs.readFileSync(path.join(promptsDir, file), 'utf-8')
        registry.set(name, { kind: 'template', body })
    }
}

export type MacroResult = {
    parsed: string
    features: Record<string, unknown>
}

export function parseMacros(raw: string): MacroResult {
    const ctx = new EvalContext()
    const parsed = evaluate(raw, ctx)
    return { parsed, features: ctx.features }
}

function evaluate(text: string, ctx: EvalContext): string {
    ctx.bumpDepth()
    try {
        let result = ''
        let i = 0
        const len = text.length

        while (i < len) {
            const char = text[i]

            if (char === '\\' && i + 1 < len) {
                const next = text[i + 1]
                if (next === '{' || next === '<' || next === '\\') {
                    result += next
                    i += 2
                    continue
                }
            }

            if (char === '{' && text[i + 1] === '{') {
                const closeIdx = findMatching(text, i + 2, '{{', '}}')
                if (closeIdx !== -1) {
                    const inner = text.slice(i + 2, closeIdx)
                    result += evaluateMacroCall(inner, ctx)
                    i = closeIdx + 2
                    continue
                }
            }

            if (char === '<' && text[i + 1] === '[') {
                const closeIdx = findMatching(text, i + 2, '<[', ']>')
                if (closeIdx !== -1) {
                    const inner = text.slice(i + 2, closeIdx)
                    result += evaluateVariable(inner, ctx)
                    i = closeIdx + 2
                    continue
                }
            }

            result += char
            i++
        }

        return result
    } finally {
        ctx.popDepth()
    }
}

function evaluateMacroCall(inner: string, ctx: EvalContext): string {
    const trimmed = inner.trim()
    const parenIdx = trimmed.indexOf('(')

    if (parenIdx === -1) {
        return evaluateScopeAccess(trimmed, inner, ctx)
    }

    if (!trimmed.endsWith(')')) {
        throw new Error(`Malformed macro call: ${trimmed}`)
    }

    const name = trimmed.slice(0, parenIdx).trim()
    const argsText = trimmed.slice(parenIdx + 1, -1).trim()

    const entry = registry.get(name)
    if (!entry) {
        throw new Error(`Macro not found: ${name}`)
    }

    ctx.features[name] = true

    let parsedArgs: Record<string, unknown> = {}
    if (argsText.length > 0) {
        const preprocessed = evaluate(argsText, ctx)
        const evaluated = safeEval(preprocessed, {})
        if (evaluated && typeof evaluated === 'object' && !Array.isArray(evaluated)) {
            parsedArgs = evaluated as Record<string, unknown>
        }
    }

    if (!ctx.enter(name)) return ''
    const prevArgs = ctx.args
    ctx.args = parsedArgs
    try {
        if (entry.kind === 'template') {
            return evaluate(entry.body, ctx)
        }
        const output = entry.fn(parsedArgs)
        return evaluate(output, ctx)
    } finally {
        ctx.args = prevArgs
        ctx.exit(name)
    }
}

/**
 * An unknown name is left verbatim rather than throwing. Note and description
 * text is expanded through here, so any `{{ ... }}` a user happens to write
 * would otherwise fail their whole turn. A misspelt *call* still throws - prose
 * rarely contains `name()` inside braces, so there the typo is worth surfacing.
 */
function evaluateScopeAccess(pathExpr: string, raw: string, ctx: EvalContext): string {
    const parts = pathExpr.split('.').map(p => p.trim()).filter(p => p.length > 0)
    const [head, ...rest] = parts
    if (head === undefined) return `{{${raw}}}`

    if (!(head in ctx.scopes)) {
        const builder = scopeBuilders.get(head)
        if (!builder) return `{{${raw}}}`
        ctx.scopes[head] = builder()
    }

    let value: unknown = ctx.scopes[head]
    for (const key of rest) {
        if (value === null || value === undefined) return ''
        if (typeof value !== 'object') return ''
        value = (value as Record<string, unknown>)[key]
    }
    return stringifyValue(value)
}

function evaluateVariable(inner: string, ctx: EvalContext): string {
    const parts = splitTopLevel(inner, '||')
    const head = (parts[0] ?? '').trim()
    const defaultExpr = parts.length > 1 ? parts.slice(1).join('||').trim() : null

    if (!head.startsWith('$')) {
        throw new Error(`Malformed variable reference: ${inner}`)
    }
    const name = head.slice(1).trim()

    const value = ctx.args[name]
    if (value !== undefined && value !== null) {
        return stringifyValue(value)
    }

    if (defaultExpr === null) return ''

    const preprocessed = evaluate(defaultExpr, ctx)
    try {
        const evaluated = safeEval(preprocessed, ctx.args)
        return stringifyValue(evaluated)
    } catch {
        return preprocessed
    }
}

function stringifyValue(value: unknown): string {
    if (value === null || value === undefined) return ''
    if (typeof value === 'string') return value
    if (typeof value === 'number' || typeof value === 'boolean') return String(value)
    try {
        return JSON.stringify(value)
    } catch {
        return String(value)
    }
}

function safeEval(expression: string, args: Record<string, unknown>): unknown {
    const argNames = Object.keys(args)
    const argValues = argNames.map(k => args[k])
    const body = `"use strict"; return (${expression});`
    const fn = new Function(...argNames, body)
    return fn(...argValues)
}

function findMatching(text: string, startIdx: number, open: string, close: string): number {
    let depth = 1
    let i = startIdx
    const len = text.length

    while (i < len) {
        const char = text[i]

        if (char === '\\' && i + 1 < len) {
            i += 2
            continue
        }

        if (char === '"' || char === "'" || char === '`') {
            const quote = char
            i++
            while (i < len && text[i] !== quote) {
                if (text[i] === '\\') i += 2
                else i++
            }
            i++
            continue
        }

        if (text.startsWith(open, i)) {
            depth++
            i += open.length
            continue
        }
        if (text.startsWith(close, i)) {
            depth--
            if (depth === 0) return i
            i += close.length
            continue
        }

        i++
    }

    return -1
}

function splitTopLevel(text: string, separator: string): string[] {
    const result: string[] = []
    let depth = 0
    let start = 0
    let i = 0
    const len = text.length

    while (i < len) {
        const char = text[i]

        if (char === '\\' && i + 1 < len) {
            i += 2
            continue
        }

        if (char === '"' || char === "'" || char === '`') {
            const quote = char
            i++
            while (i < len && text[i] !== quote) {
                if (text[i] === '\\') i += 2
                else i++
            }
            i++
            continue
        }

        if (text.startsWith('{{', i) || text.startsWith('<[', i) || char === '(' || char === '[' || char === '{') {
            depth++
            i += (text.startsWith('{{', i) || text.startsWith('<[', i)) ? 2 : 1
            continue
        }
        if (text.startsWith('}}', i) || text.startsWith(']>', i) || char === ')' || char === ']' || char === '}') {
            depth--
            i += (text.startsWith('}}', i) || text.startsWith(']>', i)) ? 2 : 1
            continue
        }

        if (depth === 0 && text.startsWith(separator, i)) {
            result.push(text.slice(start, i))
            i += separator.length
            start = i
            continue
        }

        i++
    }

    result.push(text.slice(start))
    return result
}

loadMacroFiles()
