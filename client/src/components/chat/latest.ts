import { state } from '../../state'

/**
 * Id of the most recent message in the loaded chat (max createdAt, id as
 * lexicographic tiebreaker), or null when empty. Used to decide which choice
 * prompt is still interactive — only the latest one is.
 */
export function latestMessageId(): string | null {
    const msgs = Object.values(state.currentChat.messages ?? {})
    if (msgs.length === 0) return null
    const latest = msgs.reduce((a, b) =>
        (a.createdAt - b.createdAt) > 0 ? a
            : (a.createdAt - b.createdAt) < 0 ? b
                : (a.id > b.id ? a : b)
    )
    return latest.id
}
