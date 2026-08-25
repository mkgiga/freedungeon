import { state } from '../../state'

const MENTION = /<@([^>\s]+)>/g

/**
 * Swap mentions for display names, on the way to the screen only - the stored
 * block keeps its refs, so a rename still updates old messages.
 *
 * An unresolvable id is left as written rather than blanked; a visible broken
 * ref is easier to fix than a silent gap.
 */
export function resolveMentions(text: string): string {
    if (!text.includes('<@')) return text
    return text.replace(MENTION, (whole, id) => {
        for (const actor of Object.values(state.assets.actors ?? {})) {
            if (actor.customId === id) return actor.name
        }
        return whole
    })
}
