import path from 'path'
import fs from 'fs'
import { state } from "./server"
import { getCurrentTurnResult } from "./game-state"
import { featureEnabled } from "@shared/features"

const promptsDir = path.join(import.meta.dirname, 'prompts')

// ═══════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════

/**
 * A registered macro is either a built-in function (pure: args -> string) or a
 * file-based template body that is evaluated inline within the calling
 * context — so cycles between template macros are detected by the shared
 * call stack rather than each template starting with a fresh one.
 */
type RegistryEntry =
    | { kind: 'fn'; fn: (args: Record<string, unknown>) => string }
    | { kind: 'template'; body: string }

/**
 * Context carried through recursive evaluation. Tracks the call stack (for
 * cycle detection), expansion depth (defense-in-depth backstop), the args of
 * the enclosing macro frame, and lazily-built scope objects.
 */
class EvalContext {
    stack = new Set<string>()
    depth = 0
    args: Record<string, unknown> = {}
    /**
     * Lazily-built scope objects keyed by name (e.g. `Player`). Populated on
     * first reference within an evaluation. A fresh context is built for each
     * top-level `parseMacros` call, so any mutation during one prompt cannot
     * leak into the next.
     */
    scopes: Record<string, unknown> = {}

    /**
     * Signals collected while expanding. Each registered macro that is invoked
     * sets its own key to `true`, letting callers detect which macros the user
     * placed (e.g. to avoid auto-appending content already positioned by hand).
     * Typed `unknown` so a macro can surface richer data here in the future.
     */
    features: Record<string, unknown> = {}

    static readonly MAX_DEPTH = 256

    /** Enter a macro frame. Returns false if `name` is already on the stack. */
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

// ═══════════════════════════════════════════════════════════════════════════
// Macro registry
// ═══════════════════════════════════════════════════════════════════════════

const registry = new Map<string, RegistryEntry>()

// ── Built-in macros ──────────────────────────────────────────────────────────

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
} })

registry.set('NOTES', { kind: 'fn', fn: () => {
    const currentChat = state.currentChat
    if (!currentChat) return 'No current chat'

    const result: Array<{ type: string; content: string }> = []
    for (const [id, ref] of Object.entries(currentChat.assets.notes)) {
        // Disabled notes are suppressed from the LLM prompt.
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
 * Instructions teaching the agent about the optional `choice_prompt` tool.
 * Exported so the auto-append fallback (agent.ts) and the macro share one
 * source of truth. The macro and the agent-side tool are both gated on
 * `enableChoicePrompts`, so awareness and capability stay in lockstep.
 */
export const MULTICHOICE_PROMPT_INSTRUCTIONS = `# 【Choice Prompts】

When you call \`end_turn\`, you may pass a \`choices\` array — an enumerated set of 2+ candidate next actions salient to the focus actor at this branch point. Enumerate them only when the branch genuinely narrows to a few distinct, material actions; otherwise leave the next move open, as usual. The focus actor's controller may select one — it returns next tick as \`choice("...")\` rather than \`unformatted("...")\` — or disregard the set entirely and supply any other action. A selection is the focus actor's action; treat it exactly as the equivalent \`unformatted(...)\` input. Never assume the controller is bound to the enumerated set.`

registry.set('MULTICHOICE_PROMPT_INSTRUCTIONS', { kind: 'fn', fn: () => {
    return featureEnabled(state.userPreferences, 'choicePrompts') ? MULTICHOICE_PROMPT_INSTRUCTIONS : ''
} });

// ── Scope builders ───────────────────────────────────────────────────────────
//
// Scopes are named values accessible without parens: `{{ @Player }}` or
// `{{ @Player.id }}`. They differ from registry macros (which are functions
// called with `()`): scopes resolve to a single object whose fields can be
// walked via dotted paths.
//
// A builder is invoked the first time its scope is referenced within an
// EvalContext, and the resulting object is cached on `ctx.scopes` for the
// rest of that evaluation. Because each `parseMacros` call starts with a
// fresh `scopes: {}`, builders are re-run for every prompt — there is no
// process-wide cache for the scope object to mutate.

type ScopeBuilder = () => unknown

const scopeBuilders = new Map<string, ScopeBuilder>()

scopeBuilders.set('Player', () => {
    const playerCharacterId = state.userPreferences.playerCharacterId
    if (playerCharacterId === null) return null
    const pc = state.assets.actors[playerCharacterId]
    if (!pc) return null
    return {
        id: pc.customId || pc.id,
        name: pc.name,
        description: pc.description,
        expressions: Object.keys(pc.expressions),
    }
})

// ── File-based macros ────────────────────────────────────────────────────────

/** Loads .macro files from the prompts dir into the registry as template entries. */
export function loadMacroFiles() {
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

// ═══════════════════════════════════════════════════════════════════════════
// Public API
// ═══════════════════════════════════════════════════════════════════════════

export type MacroResult = {
    /** The fully expanded text. */
    parsed: string
    /** Signals collected during expansion — see `EvalContext.features`. Each
     *  invoked macro name maps to `true`; check membership to know whether the
     *  user placed a given macro themselves. */
    features: Record<string, unknown>
}

/** Parse and expand all macros + variable substitutions in the given text. */
export function parseMacros(raw: string): MacroResult {
    const ctx = new EvalContext()
    const parsed = evaluate(raw, ctx)
    return { parsed, features: ctx.features }
}

// ═══════════════════════════════════════════════════════════════════════════
// Core evaluator — walks the text, expanding `{{ @macro(...) }}` and `<[$var]>`
// ═══════════════════════════════════════════════════════════════════════════

function evaluate(text: string, ctx: EvalContext): string {
    ctx.bumpDepth()
    try {
        let result = ''
        let i = 0
        const len = text.length

        while (i < len) {
            const char = text[i]

            // ── Escape handling ─────────────────────────────────────────────────
            // Only `\{`, `\<`, and `\\` are treated as escapes — those are the
            // only characters that actually introduce macro syntax. Any other
            // backslash is preserved verbatim so JSON strings (and any other
            // content carrying backslash escapes like `\n`, `\"`) pass through
            // re-evaluation unchanged.
            if (char === '\\' && i + 1 < len) {
                const next = text[i + 1]
                if (next === '{' || next === '<' || next === '\\') {
                    result += next
                    i += 2
                    continue
                }
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
    } finally {
        ctx.popDepth()
    }
}

// ── Macro call evaluation ────────────────────────────────────────────────────

function evaluateMacroCall(inner: string, ctx: EvalContext): string {
    // inner looks like: " @name(args) " or " @Scope.path " (whitespace stripped below)
    const trimmed = inner.trim()

    // Must start with @
    if (!trimmed.startsWith('@')) {
        return `{{${inner}}}` // not a macro, leave as-is
    }

    const parenIdx = trimmed.indexOf('(')

    // No parens → scope variable access: `@Scope` or `@Scope.path.to.field`
    if (parenIdx === -1) {
        return evaluateScopeAccess(trimmed.slice(1), ctx)
    }

    // Parse name and args
    if (!trimmed.endsWith(')')) {
        throw new Error(`Malformed macro call: ${trimmed}`)
    }

    const name = trimmed.slice(1, parenIdx).trim()
    const argsText = trimmed.slice(parenIdx + 1, -1).trim()

    const entry = registry.get(name)
    if (!entry) {
        throw new Error(`Macro not found: @${name}`)
    }

    // Record that this macro was referenced (before cycle/arg handling) so
    // callers can detect user-placed injections regardless of output.
    ctx.features[name] = true

    // Evaluate args in the CALLER's frame, before pushing `name` onto the stack.
    let parsedArgs: Record<string, unknown> = {}
    if (argsText.length > 0) {
        const preprocessed = evaluate(argsText, ctx)
        const evaluated = safeEval(preprocessed, {})
        if (evaluated && typeof evaluated === 'object' && !Array.isArray(evaluated)) {
            parsedArgs = evaluated as Record<string, unknown>
        }
    }

    // Push frame; on cycle (self or mutual), render empty.
    if (!ctx.enter(name)) return ''
    const prevArgs = ctx.args
    ctx.args = parsedArgs
    try {
        if (entry.kind === 'template') {
            // Template body evaluates with the SAME ctx — shared stack/depth/scopes
            // means mutual cycles between template macros are detected on contact.
            return evaluate(entry.body, ctx)
        }
        // Built-in fn: produces text; re-parse so any macro syntax it emits is
        // expanded against the same ctx (with `name` on the stack to catch
        // cycles in the emitted output too).
        const output = entry.fn(parsedArgs)
        return evaluate(output, ctx)
    } finally {
        ctx.args = prevArgs
        ctx.exit(name)
    }
}

// ── Scope access evaluation ──────────────────────────────────────────────────

/**
 * Resolves `@Scope` or `@Scope.path.to.field`. The scope object is built by
 * its `ScopeBuilder` on first reference and cached on `ctx.scopes` for the
 * remainder of the evaluation. If a path step is null/undefined or a
 * non-object, the result is the empty string.
 */
function evaluateScopeAccess(pathExpr: string, ctx: EvalContext): string {
    const parts = pathExpr.split('.').map(p => p.trim()).filter(p => p.length > 0)
    const [head, ...rest] = parts
    if (head === undefined) {
        throw new Error(`Empty scope reference: @`)
    }

    if (!(head in ctx.scopes)) {
        const builder = scopeBuilders.get(head)
        if (!builder) {
            throw new Error(`Scope not found: @${head}`)
        }
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
