import { query, forkSession, getSessionMessages, type SDKMessage, type SessionMessage } from '@anthropic-ai/claude-agent-sdk';
import { buildGameStateMcpServer, allTools } from './mcp';
import { rpcAnnounce } from './rpc';
import {
    setActiveChat,
    setCurrentSdkAssistantUuid,
    consumeEndTurnRequest,
} from './bridge-state';

export type PromptArgs = {
    chatId: string;
    userMessageId: string;
    userContent: string;
    systemPrompt: string;
    resumeSessionId: string | null;
    model: string;
    enableChoicePrompts?: boolean;
};

let currentAbort: AbortController | null = null;

export function cancelCurrentTurn() {
    currentAbort?.abort();
    currentAbort = null;
}

export type RunAgentPromptResult =
    | { ok: true; sessionId: string | null; aborted?: boolean }
    | { ok: false; sessionId: string | null; error: string; errorName?: string };

export async function runAgentPrompt(args: PromptArgs): Promise<RunAgentPromptResult> {
    setActiveChat(args.chatId);
    setCurrentSdkAssistantUuid(undefined);
    consumeEndTurnRequest();

    const abort = new AbortController();
    currentAbort = abort;

    const mcpServer = buildGameStateMcpServer(args.enableChoicePrompts ?? false);

    let capturedSessionId: string | null = args.resumeSessionId;
    let caughtError: { name?: string; message: string } | null = null;

    const q = query({
        prompt: args.userContent,
        options: {
            abortController: abort,
            mcpServers: { game_state: mcpServer },
            allowedTools: allTools(),
            tools: [],
            systemPrompt: args.systemPrompt,
            model: args.model,
            permissionMode: 'bypassPermissions',
            ...(args.resumeSessionId ? { resume: args.resumeSessionId } : {}),
            settingSources: [],
            persistSession: true,
        },
    });

    try {
        for await (const msg of q) {
            await handleSdkMessage(msg, args, (sessionId) => {
                capturedSessionId = sessionId;
            });
            consumeEndTurnRequest();
        }
    } catch (err) {
        // Detect abort by signal state rather than error name. The SDK
        // wraps multiple transports (subprocess IPC, fetch, websocket-
        // ish stream) and an abort can surface as 'AbortError',
        // 'AbortException', EPIPE, "stream closed", or runtime-
        // specific names. signal.aborted is the authoritative check.
        const isAbort = abort.signal.aborted;
        if (!isAbort) {
            const e = err as { name?: string; message?: string };
            caughtError = {
                name: e?.name,
                message: e?.message ?? String(err),
            };
            console.error('Agent runAgentPrompt error:', caughtError.name, caughtError.message);
        }
    } finally {
        currentAbort = null;
        setActiveChat(null);
        setCurrentSdkAssistantUuid(undefined);
        try {
            await rpcAnnounce(args.chatId, 'turn_ended');
        } catch (annErr) {
            console.error('turn_ended announce failed:', annErr);
        }
    }

    if (caughtError) {
        return {
            ok: false,
            sessionId: capturedSessionId,
            error: caughtError.message,
            errorName: caughtError.name,
        };
    }
    return {
        ok: true,
        sessionId: capturedSessionId,
        ...(abort.signal.aborted ? { aborted: true } : {}),
    };
}

async function handleSdkMessage(
    msg: SDKMessage,
    args: PromptArgs,
    onSessionCaptured: (sessionId: string) => void
) {
    switch (msg.type) {
        case 'system': {
            if ('subtype' in msg && (msg as { subtype?: string }).subtype === 'init') {
                const sid = (msg as { session_id?: string }).session_id;
                if (sid) {
                    onSessionCaptured(sid);
                    await rpcAnnounce(args.chatId, 'session_captured', sid);
                }
            }
            return;
        }
        case 'assistant': {
            // Track current assistant UUID so MCP tool handlers (firing
            // during this assistant's tool_use blocks) can attribute
            // their emitted ChatMessages.
            setCurrentSdkAssistantUuid(msg.uuid as unknown as string);
            return;
        }
        case 'result': {
            // Terminal message; the stream loop exits naturally after it.
            // Fork anchors are no longer tracked per-turn — branching resolves
            // fork points from the live session at fork time (resolveForkUpTo).
            return;
        }
        default:
            return;
    }
}

/**
 * A "real user prompt" (turn start) in a session transcript: a main-thread user
 * message that is NOT an SDK tool_result wrapper. Same discriminator the stream
 * handler used to use — content carrying a `tool_result` block is a wrapper the
 * SDK built to feed tool outputs back to the model, not a turn we initiated.
 */
function isRealUserPrompt(m: SessionMessage): boolean {
    if (m.type !== 'user' || m.parent_tool_use_id !== null) return false;
    const content = (m.message as { content?: unknown } | null)?.content;
    const isToolResult = Array.isArray(content) && content.some((b) =>
        typeof b === 'object' && b !== null && (b as { type?: string }).type === 'tool_result'
    );
    return !isToolResult;
}

/**
 * Resolve the fork boundary UUID for "keep the first `keepUserTurns` user turns"
 * against the LIVE session transcript. We read it fresh via getSessionMessages
 * rather than trusting any stored UUID, because forkSession remaps every UUID —
 * so pre-fork anchors are unusable, but the current transcript's UUIDs are always
 * valid. The boundary is the message immediately before the (keepUserTurns+1)-th
 * real user prompt = the last message of turn K, a clean turn boundary.
 *
 * Returns undefined ("keep everything") when the session has ≤ keepUserTurns user
 * turns — i.e. nothing to truncate.
 */
async function resolveForkUpTo(sessionId: string, keepUserTurns: number): Promise<string | undefined> {
    const msgs = await getSessionMessages(sessionId);
    let seen = 0;
    for (let i = 0; i < msgs.length; i++) {
        if (isRealUserPrompt(msgs[i]!)) {
            seen++;
            if (seen === keepUserTurns + 1) {
                return msgs[i - 1]?.uuid;
            }
        }
    }
    return undefined;
}

/**
 * Fork a session. With `keepUserTurns` set, truncate to the end of that many
 * user turns (resolved live); omit it for a full copy. Returns the new session id.
 */
export async function forkAndReturnNewSessionId(args: {
    sessionId: string;
    keepUserTurns?: number;
}): Promise<{ newSessionId: string }> {
    const upToMessageId = args.keepUserTurns === undefined
        ? undefined
        : await resolveForkUpTo(args.sessionId, args.keepUserTurns);
    const { sessionId } = await forkSession(args.sessionId, {
        ...(upToMessageId ? { upToMessageId } : {}),
    });
    return { newSessionId: sessionId };
}
