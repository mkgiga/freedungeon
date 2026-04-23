import emojiKeywords from 'emojilib'

type Entry = {
    char: string
    keywords: string[]
    /** All keyword sub-tokens (including canonical). */
    tokens: Set<string>
    /** Sub-tokens drawn from the FIRST keyword — the emoji's canonical name.
     *  Matches here score higher so "Watch" picks ⌚ (canonical "watch") over
     *  👀 (which has "watch" only as a non-canonical synonym). */
    canonicalTokens: Set<string>
}

const tokenize = (s: string) => s.toLowerCase().split(/[\s_\-]+/).filter(Boolean)

// Stop words we strip from item names before scoring — they're semantically
// empty in RPG item context and would otherwise match irrelevant emojis (e.g.
// "the" or "and" aren't keywords but "for" can appear via "forest" tokenization).
const STOPWORDS = new Set([
    'of', 'the', 'a', 'an', 'and', 'or',
    'in', 'on', 'at', 'to', 'with', 'by', 'from', 'for',
    'upon', 'under', 'over', 'about',
])

// Same preposition set used by `pluralizeItem` in blocks/itemText.ts — keeps
// the head-noun detection consistent across both utilities.
const FIRST_PREP_RE = /\s+(of|in|for|by|from|with|to|at|on|upon|under|over|about)\s+/i

// Build once per module load: ~1,800 entries. For each emoji we keep both the
// raw (lowercased) keywords AND flattened token lists (all + canonical). The
// token list lets a single-word item name like "apple" match the "apple"
// sub-token inside compound keywords like "red_apple" — without it, the fruit
// emojis would lose to ⌚ (whose keyword list has a standalone "apple"
// referencing the Apple Watch brand).
const ALL: Entry[] = Object.entries(emojiKeywords as Record<string, string[]>)
    .map(([char, keywords]) => {
        const lower = keywords.map(k => k.toLowerCase())
        const canonicalTokens = new Set(tokenize(lower[0] ?? ''))
        const tokens = new Set(lower.flatMap(k => tokenize(k)))
        return { char, keywords: lower, tokens, canonicalTokens }
    })

/**
 * Split an item name into its head noun and modifiers.
 *
 *   "Red Sword"               → head: [sword], mods: [red]
 *   "Tear of the Goddess"     → head: [tear], mods: [goddess]  (stopwords dropped)
 *   "Sword King's Tear"       → head: [tear], mods: [sword, king's]  (saxon genitive → head is last word)
 *   "Potion of Healing"       → head: [potion], mods: [healing]
 *   "Sword"                   → head: [sword], mods: []
 */
function segmentItemName(name: string): { head: string[]; mods: string[] } {
    const prep = name.match(FIRST_PREP_RE)
    if (prep && prep.index !== undefined) {
        const head = tokenize(name.slice(0, prep.index)).filter(w => !STOPWORDS.has(w))
        const mods = tokenize(name.slice(prep.index)).filter(w => !STOPWORDS.has(w))
        return { head, mods }
    }
    const words = tokenize(name).filter(w => !STOPWORDS.has(w))
    if (words.length <= 1) return { head: words, mods: [] }
    return { head: [words[words.length - 1]], mods: words.slice(0, -1) }
}

/**
 * Pick a deterministic emoji for an item name using a tiered matcher:
 *   1. Exact token match  — item words equal emoji tokens. Head noun matches
 *      score 2× the weight of modifier matches, and canonical-keyword hits
 *      outweigh non-canonical.
 *   2. Partial substring  — either side is a substring of the other.
 *   3. Hash fallback      — sum of char codes % catalog length, deterministic.
 */
export function pickEmojiForItem(itemName: string): string {
    const { head, mods } = segmentItemName(itemName)
    if (head.length === 0 && mods.length === 0) return hashFallback(itemName)

    const exact = score(ALL, (e) => {
        let total = 0
        for (const w of head) {
            if (e.canonicalTokens.has(w)) total += 6       // head + canonical = strongest
            else if (e.tokens.has(w)) total += 4           // head + synonym
        }
        for (const w of mods) {
            if (e.canonicalTokens.has(w)) total += 3       // modifier + canonical
            else if (e.tokens.has(w)) total += 2           // modifier + synonym
        }
        return total
    })
    if (exact.length) return exact[0].char

    const allWords = [...head, ...mods]
    const partial = score(ALL, (e) => {
        for (const kw of e.keywords) {
            for (const w of allWords) {
                if (kw.includes(w) || w.includes(kw)) return 1
            }
        }
        return 0
    })
    if (partial.length) return partial[0].char

    return hashFallback(itemName)
}

function score(entries: Entry[], entryScore: (e: Entry) => number): Array<{ char: string; total: number }> {
    const ranked: Array<{ char: string; total: number }> = []
    for (const e of entries) {
        const total = entryScore(e)
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
