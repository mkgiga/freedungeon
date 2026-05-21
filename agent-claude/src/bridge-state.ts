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
