import { query, forkSession, type SDKUserMessage, type SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { buildGameStateMcpServer, allTools } from './mcp';
import { rpcAnnounce, rpcRecordSdkUuid } from './rpc';
import { setActiveChat, setCurrentSdkAssistantUuid, consumeEndTurnRequest } from './bridge-state';

export type PromptArgs = {
    chatId: string;
    userMessageId: string;
    userContent: string;
    systemPrompt: string;
    resumeSessionId: string | null;
    model: string;
};

let currentAbort: AbortController | null = null;

export function cancelCurrentTurn() {
    currentAbort?.abort();
    currentAbort = null;
}

export async function runAgentPrompt(args: PromptArgs): Promise<{ ok: true; sessionId: string | null }> {
    setActiveChat(args.chatId);
    setCurrentSdkAssistantUuid(undefined);
    consumeEndTurnRequest(); // clear stale flag from prior turn

    const abort = new AbortController();
    currentAbort = abort;

    const mcpServer = buildGameStateMcpServer();

    let capturedSessionId: string | null = args.resumeSessionId;

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
            if (consumeEndTurnRequest()) {
                // The model called end_turn; let the SDK finish flushing
                // the tool_result and the model's final wrap-up text. We
                // don't break out — natural end-of-conversation comes
                // from the SDK emitting a result message.
            }
        }
    } catch (err) {
        if ((err as Error)?.name === 'AbortError') {
            // Cancelled — no rethrow.
        } else {
            throw err;
        }
    } finally {
        currentAbort = null;
        setActiveChat(null);
        setCurrentSdkAssistantUuid(undefined);
        await rpcAnnounce(args.chatId, 'turn_ended');
    }

    return { ok: true, sessionId: capturedSessionId };
}

async function handleSdkMessage(
    msg: SDKMessage,
    args: PromptArgs,
    onSessionCaptured: (sessionId: string) => void
) {
    switch (msg.type) {
        case 'system': {
            // The `system` init message carries the session_id we need to
            // persist for cache-friendly resume on the next prompt.
            if ('subtype' in msg && (msg as any).subtype === 'init') {
                const sid = (msg as any).session_id as string | undefined;
                if (sid) {
                    onSessionCaptured(sid);
                    await rpcAnnounce(args.chatId, 'session_captured', sid);
                }
            }
            return;
        }
        case 'assistant': {
            // Track the current assistant UUID so MCP tool handlers
            // (which fire during this assistant's tool_use blocks) can
            // attribute their emitted ChatMessages.
            setCurrentSdkAssistantUuid(msg.uuid as unknown as string);
            return;
        }
        case 'user': {
            // SDK emits two flavors of user message during a turn:
            //   1. The actual user prompt we sent (parent_tool_use_id === null)
            //   2. Tool-result wrappers carrying tool_use outputs back to the
            //      model (parent_tool_use_id !== null, often isSynthetic === true)
            // Only (1) corresponds to our userMessageId — recording (2) would
            // overwrite the real prompt's UUID with a tool-result UUID that
            // forkSession can't anchor on reliably.
            const parentToolUseId = (msg as unknown as { parent_tool_use_id: string | null }).parent_tool_use_id;
            const isSynthetic = (msg as unknown as { isSynthetic?: boolean }).isSynthetic === true;
            if (parentToolUseId !== null || isSynthetic) return;

            const uuid = msg.uuid as unknown as string | undefined;
            if (uuid) {
                await rpcRecordSdkUuid(args.chatId, args.userMessageId, uuid);
            }
            return;
        }
        case 'result': {
            // Final message — loop exits naturally after this.
            return;
        }
        default:
            return;
    }
}

export async function forkAndReturnNewSessionId(args: {
    sessionId: string;
    upToMessageId: string;
}): Promise<{ newSessionId: string }> {
    const { sessionId } = await forkSession(args.sessionId, {
        upToMessageId: args.upToMessageId,
    });
    return { newSessionId: sessionId };
}
