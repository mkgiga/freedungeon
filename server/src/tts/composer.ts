import type { FeatureConfig } from '@shared/features'

/**
 * Turns one line of character dialogue into a DramaBox TTS prompt via an
 * OpenAI-compatible chat completion (the user's self-hosted llama-server etc.).
 * A single stateless call — no tools, no streaming. The main RP agent never
 * sees any of this.
 */

/**
 * Shared spec for the structured intermediate format both paths emit. The
 * composer model and (in degraded mode) the main agent describe HOW a line is
 * delivered as typed segments; `segmentsToPrompt` renders the DramaBox grammar
 * deterministically, so neither model touches the grammar's reserved
 * punctuation (which a small model gets wrong).
 */
const SEGMENT_FORMAT = `Each segment is an object with "type" and "content", in order:
- "character_clause" — who is speaking and how: their voice and overall delivery. Exactly one, first. Present tense. Must name the speaker as a noun phrase (a/an + character) with a speaking verb, then the delivery — match age/gender to the voice. E.g. "A gruff old man speaks in a tired flat tone", "An exhausted father speaks with fraying patience", "She speaks softly". Never give the delivery alone with the speaker dropped (not "Deep and sincere, not a hint of sarcasm").
- "dialogue_line" — a verbatim span of the spoken words.
- "action_direction" — how the next words are delivered, or an audible beat between them (a laugh, a sigh, a pause, a sob, a rising shout). AUDIBLE only — never visual (no grins, nods, smiles, glances).

Rules:
- Preserve the dialogue's exact words across the dialogue_line segments; never paraphrase.
- Be faithful to the emotional register of the line in its scene: match it. Don't flatten genuine emotion — anger, grief, fear, joy, shouting, sobbing — and don't manufacture drama a calm moment doesn't have.
- Split into multiple dialogue_line segments (separated by an action_direction) only where the delivery genuinely shifts; a single dialogue_line is fine otherwise.
- A laugh or sound the character actually voices (Hahaha, Hehehe, Hmm, Mmmmm) stays INSIDE a dialogue_line as words.`

// Composer (small external model). It is given the recent scene as context
// since, unlike the main agent, it has no memory of the conversation.
const SYSTEM_PROMPT = `You are a performance director. Given a character, the recent scene, and one line of their dialogue, break the line into how it is delivered, as a JSON array of segments — output NOTHING but that array.

${SEGMENT_FORMAT}

Use the recent scene to judge the emotional intensity and tone; never include any of it in the output. Output ONLY the JSON array.`

/**
 * Degraded-mode instructions for the MAIN agent (when the composer is
 * unreachable). The agent already has full scene context, so it just fills the
 * `voice` argument with the same segment format — no scene recap needed.
 * Exported so it can be placed via the `@VOICE_ACTING_INSTRUCTIONS()` macro or
 * appended trailing.
 */
export const VOICE_ACTING_INSTRUCTIONS = `# 【Voice Acting】

On every \`speech\` call, also pass a \`voice\` argument: an ordered array of segments describing how the line is delivered.

${SEGMENT_FORMAT}`

/**
 * Cheap reachability check for the composer endpoint (OpenAI `/models`). Used
 * per-turn to decide whether to fall back to agent-authored voice prompts.
 */
export async function probeComposer(cfg: FeatureConfig): Promise<boolean> {
    const endpoint = String(cfg.values.composerEndpoint ?? '').replace(/\/+$/, '')
    if (!endpoint) return false
    const apiKey = String(cfg.values.composerApiKey ?? '')
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 1500)
    try {
        const res = await fetch(`${endpoint}/models`, {
            headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
            signal: ctrl.signal,
        })
        return res.ok
    } catch {
        return false
    } finally {
        clearTimeout(timer)
    }
}

export type ComposeInput = {
    actorName: string
    actorDescription: string
    dialogue: string
    /** Recent preceding narration/dialogue, for tone only. May be empty. */
    context: string
}

export type Segment = { type: 'character_clause' | 'dialogue_line' | 'action_direction'; content: string }

/**
 * Coerce a model's output into validated segments — accepts either a JSON string
 * (the composer's chat completion, possibly fenced/surrounded by prose) or an
 * already-structured array (the agent's `voice` tool argument). Returns [] for
 * anything unusable so callers can fall back.
 */
export function coerceSegments(value: unknown): Segment[] {
    let arr: unknown = value
    if (typeof value === 'string') {
        let txt = value.trim()
        const fence = txt.match(/```(?:json)?\s*([\s\S]*?)```/i)
        if (fence?.[1]) txt = fence[1].trim()
        const start = txt.indexOf('[')
        const end = txt.lastIndexOf(']')
        if (start === -1 || end <= start) return []
        try { arr = JSON.parse(txt.slice(start, end + 1)) } catch { return [] }
    }
    if (!Array.isArray(arr)) return []
    const segs: Segment[] = []
    for (const s of arr) {
        const t = (s as { type?: unknown })?.type
        const c = (s as { content?: unknown })?.content
        if ((t === 'character_clause' || t === 'dialogue_line' || t === 'action_direction') && typeof c === 'string') {
            segs.push({ type: t, content: c })
        }
    }
    return segs
}

const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s)

// Commas (and ; :) are reserved separators in DramaBox grammar, so strip them
// from outside-the-quote clauses; also drop wrapping/trailing punctuation we
// control ourselves.
function sanitizeClause(s: string): string {
    return cap(
        s.replace(/[“”‘’"']/g, '')
            .replace(/[,;:—–]/g, ' ')
            .replace(/\s+/g, ' ')
            .replace(/[.\s]+$/, '')
            .trim()
    )
}

const cleanDialogue = (s: string) =>
    s.replace(/^[\s"'“”]+|[\s"'“”]+$/g, '')
        // Em/en-dashes (and `--`) inside spoken text make the model hallucinate;
        // they read as a pause, so render them as a comma — which is fine inside
        // quotes (only the clause/quote-separating comma is reserved).
        .replace(/\s*(?:[—–]|--)\s*/g, ', ')
        .replace(/\s+([,.!?])/g, '$1')
        .replace(/\s+/g, ' ')
        .trim()

/**
 * Render segments into DramaBox grammar: `<clause>, "<dialogue>" <clause>, "..."`.
 * Each non-dialogue segment is the lead-in for the dialogue that follows (joined
 * by the single reserved comma). A non-dialogue segment with no dialogue after
 * it becomes a standalone beat ending in a period — except a *trailing* one,
 * which is dropped, since a DramaBox prompt must end on a closing quote.
 */
export function segmentsToPrompt(segments: Segment[]): string {
    const parts: string[] = []
    let clause: string | null = null
    for (const seg of segments) {
        if (seg.type === 'dialogue_line') {
            const quote = `"${cleanDialogue(seg.content)}"`
            if (clause) { parts.push(`${clause}, ${quote}`); clause = null }
            else parts.push(quote)
        } else {
            if (clause) parts.push(`${clause}.`) // prior clause had no quote → standalone beat
            clause = sanitizeClause(seg.content)
        }
    }
    // Dangling trailing clause intentionally dropped (end on a quote).
    return parts.join(' ').trim()
}

export async function composeVoicePrompt(cfg: FeatureConfig, input: ComposeInput): Promise<string> {
    const endpoint = String(cfg.values.composerEndpoint ?? '').replace(/\/+$/, '')
    const model = String(cfg.values.composerModel ?? '')
    const apiKey = String(cfg.values.composerApiKey ?? '')
    if (!endpoint || !model) throw new Error('TTS composer endpoint/model not configured')

    const character = input.actorDescription
        ? `${input.actorName} — ${input.actorDescription}`
        : input.actorName
    const userMsg = [
        `Character: ${character}`,
        input.context ? `Recent scene (tone only, do not voice):\n${input.context}` : '',
        `Line: ${input.dialogue}`,
    ].filter(Boolean).join('\n\n')

    const res = await fetch(`${endpoint}/chat/completions`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
        },
        body: JSON.stringify({
            model,
            messages: [
                { role: 'system', content: SYSTEM_PROMPT },
                { role: 'user', content: userMsg },
            ],
            temperature: 0.7,
            max_tokens: 500,
            stream: false,
        }),
    })
    if (!res.ok) {
        const t = await res.text().catch(() => '')
        throw new Error(`composer ${res.status}: ${t.slice(0, 200)}`)
    }
    const data = await res.json() as { choices?: { message?: { content?: string } }[] }
    const out = data.choices?.[0]?.message?.content?.trim()
    if (!out) throw new Error('composer returned empty output')

    // Transform the structured intermediate format into DramaBox grammar.
    const segments = coerceSegments(out)
    if (!segments.some(s => s.type === 'dialogue_line')) {
        throw new Error('composer produced no dialogue lines')
    }
    const prompt = segmentsToPrompt(segments)
    if (!prompt) throw new Error('composer produced an empty prompt')
    return prompt
}
