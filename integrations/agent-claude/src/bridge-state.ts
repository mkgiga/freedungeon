
let activeChatId: string | null = null;
let currentSdkAssistantUuid: string | undefined = undefined;
let endTurnRequested = false;

let producedMessageIds: string[] = [];
let lastTrailingWrapperUuid: string | undefined = undefined;
let lastTrailingWrapperSessionId: string | undefined = undefined;

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

export function setLastTrailingWrapperUuid(uuid: string, sessionId: string | undefined) {
    lastTrailingWrapperUuid = uuid;
    if (sessionId) lastTrailingWrapperSessionId = sessionId;
}

/**
 * Snapshot and reset per-turn state. Called when the SDK stream emits
 * its terminal `result` message — by then all wrapper UUIDs for this
 * turn have been observed and all tool calls have produced their
 * ChatMessages.
 */
export function consumeTurnState(): {
    producedMessageIds: string[];
    trailingWrapperUuid: string | undefined;
    trailingWrapperSessionId: string | undefined;
} {
    const snapshot = {
        producedMessageIds: producedMessageIds.slice(),
        trailingWrapperUuid: lastTrailingWrapperUuid,
        trailingWrapperSessionId: lastTrailingWrapperSessionId,
    };
    producedMessageIds = [];
    lastTrailingWrapperUuid = undefined;
    lastTrailingWrapperSessionId = undefined;
    return snapshot;
}
