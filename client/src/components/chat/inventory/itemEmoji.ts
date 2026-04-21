import emojiKeywords from 'emojilib'

type Entry = { char: string; keywords: string[] }

// Build once per module load: ~1,800 entries. Each keyword is lowercased up
// front so the matcher can do plain string comparisons without per-call
// case-folding overhead.
const ALL: Entry[] = Object.entries(emojiKeywords as Record<string, string[]>)
    .map(([char, keywords]) => ({ char, keywords: keywords.map(k => k.toLowerCase()) }))

const tokenize = (s: string) => s.toLowerCase().split(/[\s_\-]+/).filter(Boolean)

/**
 * Pick a deterministic emoji for an item name using a tiered matcher:
 *   1. Exact token match  — an item word equals one of the emoji's keywords.
 *   2. Partial substring  — either side is a substring of the other.
 *   3. Hash fallback      — sum of char codes % catalog length, so the same
 *                           name always resolves to the same emoji.
 */
export function pickEmojiForItem(itemName: string): string {
    const words = tokenize(itemName)
    if (!words.length) return hashFallback(itemName)

    const exact = score(ALL, (kw) => words.includes(kw) ? 2 : 0)
    if (exact.length) return exact[0].char

    const partial = score(ALL, (kw) => {
        for (const w of words) {
            if (kw.includes(w) || w.includes(kw)) return 1
        }
        return 0
    })
    if (partial.length) return partial[0].char

    return hashFallback(itemName)
}

function score(entries: Entry[], kwScore: (kw: string) => number): Array<{ char: string; total: number }> {
    const ranked: Array<{ char: string; total: number }> = []
    for (const e of entries) {
        let total = 0
        for (const kw of e.keywords) total += kwScore(kw)
        if (total > 0) ranked.push({ char: e.char, total })
    }
    ranked.sort((a, b) => b.total - a.total)
    return ranked
}

function hashFallback(s: string): string {
    let h = 0
    for (let i = 0; i < s.length; i++) h = (h + s.charCodeAt(i)) | 0
    return ALL[Math.abs(h) % ALL.length].char
}
