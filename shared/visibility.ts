/**
 * Soft-delete visibility, in one place.
 *
 * Deleting an actor or a note never removes the row: chat history resolves them
 * live (SpeechBlock looks the actor up by `customId` on every render), so a real
 * delete would strip portraits and expressions out of messages already written.
 *
 * The rule is therefore: **rows always exist; visibility is a filter.** Anything
 * that presents a library, a picker, or an agent tool applies it. History does
 * not, which is the entire point.
 *
 * Shared rather than reimplemented per call site because there are a dozen of
 * them, and one that forgets is a deleted character quietly reappearing in a
 * picker — or worse, in the agent's tool results.
 */

export type SoftDeletable = { deletedAt?: number | null }

export function isDeleted(row: SoftDeletable): boolean {
    return row.deletedAt != null
}

/** The subset a user (or the agent) should be offered. */
export function visible<T extends SoftDeletable>(rows: T[]): T[] {
    return rows.filter(row => !isDeleted(row))
}

export type Homed = { homeChatId?: string | null }

/**
 * The global library: everything that isn't deleted and hasn't been authored
 * for a specific Scenario. Scenario-authored characters and notes stay out of
 * the user's main lists so a scenario's supporting cast doesn't clutter them.
 */
export function inLibrary<T extends SoftDeletable & Homed>(rows: T[]): T[] {
    return visible(rows).filter(row => row.homeChatId == null)
}

/** Everything a given Scenario authored — its private cast. */
export function homedIn<T extends SoftDeletable & Homed>(rows: T[], chatId: string): T[] {
    return visible(rows).filter(row => row.homeChatId === chatId)
}
