const SERVER_RPC_URL = process.env.SERVER_RPC_URL ?? 'http://127.0.0.1:8078/agent-rpc';

export type ServerExecResponse =
    | { ok: true; messageId: string; effects: string }
    | { error: string };

export type ServerQueryResponse =
    | { ok: true; result: string }
    | { error: string };

export async function rpcExec(
    chatId: string,
    command: string,
    args: Record<string, unknown>,
    sdkUuid: string | undefined
): Promise<ServerExecResponse> {
    return rpcCall({ kind: 'exec', chatId, command, args, sdkUuid }) as Promise<ServerExecResponse>;
}

export async function rpcQuery(
    chatId: string,
    query: string,
    args: Record<string, unknown>
): Promise<ServerQueryResponse> {
    return rpcCall({ kind: 'query', chatId, query, args }) as Promise<ServerQueryResponse>;
}

export async function rpcAnnounce(
    chatId: string,
    event: 'turn_started' | 'turn_ended' | 'session_captured',
    sessionId?: string
): Promise<{ ok: true } | { error: string }> {
    return rpcCall({ kind: 'announce', chatId, event, sessionId }) as Promise<{ ok: true } | { error: string }>;
}

export async function rpcRecordSdkUuid(
    chatId: string,
    messageId: string,
    sdkUuid: string
): Promise<{ ok: true } | { error: string }> {
    return rpcCall({ kind: 'sdk_uuid', chatId, messageId, sdkUuid }) as Promise<{ ok: true } | { error: string }>;
}

/**
 * Stamp metadata.sdkTurnCloserUuid on a batch of ChatMessages — the
 * userMessageId that initiated the turn plus every assistant block the
 * agent produced during it. Called once per turn after the SDK loop
 * settles on a `result` message.
 */
export async function rpcAnnounceTurnClosed(
    chatId: string,
    messageIds: string[],
    trailingWrapperUuid: string,
    trailingWrapperSessionId: string
): Promise<{ ok: true } | { error: string }> {
    return rpcCall({
        kind: 'turn_closed',
        chatId,
        messageIds,
        trailingWrapperUuid,
        trailingWrapperSessionId,
    }) as Promise<{ ok: true } | { error: string }>;
}

async function rpcCall(body: object): Promise<unknown> {
    const res = await fetch(SERVER_RPC_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    if (!res.ok) {
        const text = await res.text().catch(() => '');
        return { error: `server_rpc_${res.status}: ${text}` };
    }
    return res.json();
}

export type ServerScenarioResponse =
    | { result: string }
    | { error: string };

/**
 * Execute one Scenario collaborator tool. The subprocess holds no scenario
 * state of its own — the server owns the scoped deps, so every call goes back.
 */
export async function rpcScenarioTool(
    chatId: string,
    tool: string,
    args: Record<string, unknown>
): Promise<ServerScenarioResponse> {
    return rpcCall({ kind: 'scenario', chatId, tool, args }) as Promise<ServerScenarioResponse>;
}
