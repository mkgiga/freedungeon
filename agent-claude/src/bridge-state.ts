/**
 * Per-turn mutable state shared between the MCP tool handlers and the
 * agent loop driver. The handlers run in the same process as the loop
 * (in-process SDK MCP server), so plain module-level state is fine.
 *
 * Why module-level instead of closed over: the tool handlers are
 * constructed once per server build, but the active chat / assistant
 * UUID changes on every turn (and every assistant message within a
 * turn). Threading those through every tool factory closure would mean
 * rebuilding the MCP server per message. This module is the indirection.
 */

let activeChatId: string | null = null;
let currentSdkAssistantUuid: string | undefined = undefined;
let endTurnRequested = false;

/**
 * IDs of ChatMessages the server appended during the current turn (as
 * reported back from /agent-rpc exec responses). At turn end we send
 * these — along with the trailing wrapper UUID — to /agent-rpc so the
 * server can stamp metadata.sdkTurnCloserUuid on each. That UUID is the
 * fork anchor we use later to rewind/regenerate/branch with the prompt
 * cache preserved.
 */
let producedMessageIds: string[] = [];
let lastTrailingWrapperUuid: string | undefined = undefined;

export function setActiveChat(chatId: string | null) {
    activeChatId = chatId;
}

export function getActiveChatId(): string | null {
    return activeChatId;
}

export function setCurrentSdkAssistantUuid(uuid: string | undefined) {
    currentSdkAssistantUuid = uuid;
}

export function getCurrentSdkAssistantUuid(): string | undefined {
    return currentSdkAssistantUuid;
}

export function requestEndTurn() {
    endTurnRequested = true;
}

export function consumeEndTurnRequest(): boolean {
    const v = endTurnRequested;
    endTurnRequested = false;
    return v;
}

export function recordProducedMessageId(messageId: string) {
    producedMessageIds.push(messageId);
}

export function setLastTrailingWrapperUuid(uuid: string) {
    lastTrailingWrapperUuid = uuid;
}

/**
 * Snapshot and reset per-turn state. Called when the SDK stream emits
 * its terminal `result` message — by then all wrapper UUIDs for this
 * turn have been observed and all tool calls have produced their
 * ChatMessages.
 */
export function consumeTurnState(): { producedMessageIds: string[]; trailingWrapperUuid: string | undefined } {
    const snapshot = {
        producedMessageIds: producedMessageIds.slice(),
        trailingWrapperUuid: lastTrailingWrapperUuid,
    };
    producedMessageIds = [];
    lastTrailingWrapperUuid = undefined;
    return snapshot;
}
