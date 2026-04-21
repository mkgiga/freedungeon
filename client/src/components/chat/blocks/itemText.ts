import pluralize from 'pluralize'

/**
 * Matches the first English preposition that separates a noun phrase's head
 * from its modifier. "Tear of the Goddess" → head: "Tear", modifier: "of the Goddess".
 * Plain compound nouns without a preposition ("Health Potion") fall through
 * to `pluralize` which pluralizes the last word — the correct head in that case.
 */
const FIRST_PREP_RE = /\s+(of|in|for|by|from|with|to|at|on|upon|under|over|about)\s+/i

/**
 * Pluralize an item name correctly when it contains a PP modifier:
 *   "Tear of the Goddess" → "Tears of the Goddess"
 *   "Ring of Power" → "Rings of Power"
 *   "Health Potion" → "Health Potions"   (no prep — pluralize handles it)
 *   "Sword" → "Swords"
 */
export function pluralizeItem(name: string, qty: number): string {
    const match = name.match(FIRST_PREP_RE)
    if (!match || match.index === undefined) {
        return pluralize(name, qty)
    }
    const head = name.slice(0, match.index)
    const rest = name.slice(match.index)
    return `${pluralize(head, qty)}${rest}`
}

/**
 * Crude a/an picker. Correct for most English nouns that start with a
 * consonant or vowel letter; misses the phonetic cases ("an hour",
 * "a unicorn"). Good enough for RPG item names; swap to the `indefinite`
 * package if edge cases crop up.
 */
export function aOrAn(word: string): string {
    return /^[aeiou]/i.test(word) ? 'an' : 'a'
}
