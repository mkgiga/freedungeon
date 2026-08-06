import { state } from '../../state'

/**
 * `<@actor_id>` inside narration and dialogue.
 *
 * The `text()` tool has always advertised this syntax to the model, but nothing
 * ever consumed it, so the refs reached the screen verbatim. Actors are
 * referenced by `customId` here, matching speech blocks and every game-state
 * tool.
 */
const MENTION = /<@([^>\s]+)>/g

/**
 * Swap mentions for display names.
 *
 * Applied only on the way to the screen — the stored block keeps its refs, so
 * renaming an actor still updates old messages and editing a line doesn't
 * silently freeze the name in. An unresolvable id is left exactly as written
 * rather than blanked: a visible broken ref is easier to fix than a silent gap.
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
