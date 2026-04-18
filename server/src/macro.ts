import path from 'path'
import fs from 'fs'
import { state } from "./server"
import { getCurrentTurnResult } from "./game-state"

const promptsDir = path.join(import.meta.dirname, 'prompts')

// ═══════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════

/** A macro is a function that takes named arguments and returns a string. */
type Macro = (args: Record<string, unknown>) => string

/** Context carried through recursive evaluation — tracks the call stack to detect cycles. */
type EvalContext = {
    stack: Set<string>
    /** Named arguments accessible via <[$name]> inside the current macro's template. */
    args: Record<string, unknown>
}

const EMPTY_CONTEXT: EvalContext = { stack: new Set(), args: {} }

// ═══════════════════════════════════════════════════════════════════════════
// Macro registry
// ═══════════════════════════════════════════════════════════════════════════

const registry = new Map<string, Macro>()

// ── Built-in macros ──────────────────────────────────────────────────────────

registry.set('ACTORS', () => {
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

    // Always include the player character
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
})

registry.set('NOTES', () => {
    const currentChat = state.currentChat
    if (!currentChat) return 'No current chat'

    const result: Array<{ title: string; type: string; content: string }> = []
    for (const id of currentChat.assets.notes) {
        const note = state.assets.notes[id]
        if (!note) continue
        result.push({ title: note.title, type: note.type, content: note.content })
    }
    return JSON.stringify(result, null, 2)
})

registry.set('PLAYER_NAME', () => {
    const playerCharacterId = state.userPreferences.playerCharacterId
    const pc = state.assets.actors[playerCharacterId!]
    return pc ? pc.name : 'Player';
});

registry.set('PLAYER', () => {
    const playerCharacterId = state.userPreferences.playerCharacterId
    const customId = playerCharacterId ? (state.assets.actors[playerCharacterId]?.customId || playerCharacterId) : "null";
    return customId
});

registry.set('GAME_STATE', () => {
    return getCurrentTurnResult()?.systemPromptGameState ?? '';
});

// ── File-based macros ────────────────────────────────────────────────────────

/** Loads .macro files from the prompts dir into the registry. */
export function loadMacroFiles() {
    if (!fs.existsSync(promptsDir)) {
        fs.mkdirSync(promptsDir, { recursive: true })
        return
    }
    const files = fs.readdirSync(promptsDir).filter(f => f.endsWith('.macro'))
    for (const file of files) {
        const name = path.basename(file, '.macro')
        const template = fs.readFileSync(path.join(promptsDir, file), 'utf-8')
        registry.set(name, createTemplateMacro(name, template))
    }
}

/** Wraps a template string as a Macro function. */
function createTemplateMacro(name: string, template: string): Macro {
    return (args) => {
        // Evaluate the template as a macro body; the args become <[$name]> locals.
        // Self-reference is silently rendered as empty (allows a macro file to
        // contain its own usage examples without infinite recursion).
        const ctx: EvalContext = { stack: new Set([name]), args }
        return evaluate(template, ctx)
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// Public API
// ═══════════════════════════════════════════════════════════════════════════

/** Parse and expand all macros + variable substitutions in the given text. */
export function parseMacros(raw: string): string {
    return evaluate(raw, EMPTY_CONTEXT)
}

// ═══════════════════════════════════════════════════════════════════════════
// Core evaluator — walks the text, expanding `{{ @macro(...) }}` and `<[$var]>`
// ═══════════════════════════════════════════════════════════════════════════

function evaluate(text: string, ctx: EvalContext): string {
    let result = ''
    let i = 0
    const len = text.length

    while (i < len) {
        const char = text[i]

        // ── Escape handling ─────────────────────────────────────────────────
        if (char === '\\' && i + 1 < len) {
            result += text[i + 1]
            i += 2
            continue
        }

        // ── Macro call: {{ @name(args) }} ───────────────────────────────────
        if (char === '{' && text[i + 1] === '{') {
            const closeIdx = findMatching(text, i + 2, '{{', '}}')
            if (closeIdx !== -1) {
                const inner = text.slice(i + 2, closeIdx)
                result += evaluateMacroCall(inner, ctx)
                i = closeIdx + 2
                continue
            }
        }

        // ── Variable substitution: <[$name]> or <[$name || default]> ────────
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
}

// ── Macro call evaluation ────────────────────────────────────────────────────

function evaluateMacroCall(inner: string, ctx: EvalContext): string {
    // inner looks like: " @name(args) " (whitespace stripped below)
    const trimmed = inner.trim()

    // Must start with @
    if (!trimmed.startsWith('@')) {
        return `{{${inner}}}` // not a macro, leave as-is
    }

    // Parse name and args
    const parenIdx = trimmed.indexOf('(')
    if (parenIdx === -1 || !trimmed.endsWith(')')) {
        throw new Error(`Malformed macro call: ${trimmed}`)
    }

    const name = trimmed.slice(1, parenIdx).trim()
    const argsText = trimmed.slice(parenIdx + 1, -1).trim()

    // Self-reference or circular dep? Render empty.
    if (ctx.stack.has(name)) {
        return ''
    }

    const macro = registry.get(name)
    if (!macro) {
        throw new Error(`Macro not found: @${name}`)
    }

    // Evaluate args inside-out: first expand any nested macros/vars, then JS-eval
    // the object literal (if any).
    let parsedArgs: Record<string, unknown> = {}
    if (argsText.length > 0) {
        const preprocessed = evaluate(argsText, ctx)
        const evaluated = safeEval(preprocessed, {})
        if (evaluated && typeof evaluated === 'object' && !Array.isArray(evaluated)) {
            parsedArgs = evaluated as Record<string, unknown>
        }
    }

    // Push onto the stack, evaluate the macro, pop.
    ctx.stack.add(name)
    const newCtx: EvalContext = { stack: ctx.stack, args: parsedArgs }
    const output = macro(parsedArgs)
    // Re-parse output for any macros the template body produced.
    // The stack still contains `name`, which catches cycles in the output too.
    const expanded = evaluate(output, newCtx)
    ctx.stack.delete(name)

    return expanded
}

// ── Variable substitution evaluation ─────────────────────────────────────────

function evaluateVariable(inner: string, ctx: EvalContext): string {
    // inner looks like: " $name " or " $name || default "
    const parts = splitTopLevel(inner, '||')
    const head = (parts[0] ?? '').trim()
    const defaultExpr = parts.length > 1 ? parts.slice(1).join('||').trim() : null

    // Must start with $
    if (!head.startsWith('$')) {
        throw new Error(`Malformed variable reference: ${inner}`)
    }
    const name = head.slice(1).trim()

    const value = ctx.args[name]
    if (value !== undefined && value !== null) {
        return stringifyValue(value)
    }

    if (defaultExpr === null) return ''

    // Preprocess the default expression for any nested macros/vars first,
    // then evaluate as a JS expression. Macros that produce strings get
    // embedded as JSON-quoted literals so they're valid JS.
    const preprocessed = evaluate(defaultExpr, ctx)
    try {
        const evaluated = safeEval(preprocessed, ctx.args)
        return stringifyValue(evaluated)
    } catch {
        // If the preprocessed text isn't valid JS (e.g. it was just plain text),
        // return it as-is.
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

// ═══════════════════════════════════════════════════════════════════════════
// Sandboxed JS eval
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Evaluates a JS expression in a minimally-sandboxed Function.
 *
 * SECURITY: `new Function` has access to the global scope. This is OK for our
 * single-user local app where macro content is authored by the user themselves.
 * Do NOT expose this to untrusted input without a proper sandbox (realms, SES,
 * QuickJS, etc.).
 */
function safeEval(expression: string, args: Record<string, unknown>): unknown {
    const argNames = Object.keys(args)
    const argValues = argNames.map(k => args[k])
    // Wrap in parens so object literals aren't parsed as statement blocks.
    const body = `"use strict"; return (${expression});`
    const fn = new Function(...argNames, body)
    return fn(...argValues)
}

// ═══════════════════════════════════════════════════════════════════════════
// Helpers: delimiter matching + top-level splitting
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Finds the matching close delimiter for an open delimiter at `startIdx`,
 * handling nested pairs, string literals, and escape sequences.
 * Returns the index of the close delimiter, or -1 if unclosed.
 */
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

        // Skip over string literals
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

/**
 * Splits a string on a separator, but only at the top level — ignoring the
 * separator when it appears inside `{{ }}`, `<[ ]>`, quotes, or parens/brackets.
 */
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

// ═══════════════════════════════════════════════════════════════════════════
// Initialization
// ═══════════════════════════════════════════════════════════════════════════

loadMacroFiles()
