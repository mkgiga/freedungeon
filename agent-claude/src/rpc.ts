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
