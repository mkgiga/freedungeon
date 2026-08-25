import { state } from '../../state'

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
