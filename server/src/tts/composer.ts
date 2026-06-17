import type { FeatureConfig } from '@shared/features'

/**
 * Turns one line of character dialogue into a DramaBox TTS prompt via an
 * OpenAI-compatible chat completion (the user's self-hosted llama-server etc.).
 * A single stateless call — no tools, no streaming. The main RP agent never
 * sees any of this.
 */

const SYSTEM_PROMPT = `You convert a single line of character dialogue into a DramaBox TTS prompt. DramaBox is an expressive text-to-speech model.

Format rules:
- Output ONE line: a short speaker description, then the dialogue in double quotes, with stage directions OUTSIDE the quotes between/after quoted segments.
- Voiced non-verbals go INSIDE the quotes as words: "Hahaha", "Hehehe", "Hmm", "Mmmmm", "Ugh", "Argh", "Ahhh".
- Stage directions go OUTSIDE the quotes: She sighs deeply. His voice cracks. A long pause. He clears his throat.
- NEVER put these inside quotes: Ahem, Pfft, Sigh, Gasp, Cough.
- End the prompt on a closing quote — no trailing description after the final quote.
- Preserve the dialogue's exact words; you may split it into multiple quoted segments to reflect shifts in tone within the line.
- Make the speaker description and directions fit the given character. Use the recent scene only to judge tone — never voice it.
- Output ONLY the prompt. No preamble, no explanation, no markdown, no quotes around the whole thing.

Examples:
Character: A shadowy villain, cold and menacing.
Line: You have entered my domain, mortal. Such arrogance will be your undoing.
A shadowy villain speaks with cold menace, "You have entered my domain, mortal." He chuckles darkly, "Such arrogance will be your undoing."

Character: A tender woman saying goodnight to her partner.
Line: It has been a long day, my love. Close your eyes, I am right here.
A woman speaks tenderly, "It has been a long day, my love." She whispers, "Close your eyes. I am right here."`

export type ComposeInput = {
    actorName: string
    actorDescription: string
    dialogue: string
    /** Recent preceding narration/dialogue, for tone only. May be empty. */
    context: string
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
            max_tokens: 400,
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
    return out
}
