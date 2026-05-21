import { query, forkSession, type SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { buildGameStateMcpServer, allTools } from './mcp';
import { rpcAnnounce, rpcRecordSdkUuid, rpcAnnounceTurnClosed } from './rpc';
import {
    setActiveChat,
    setCurrentSdkAssistantUuid,
    consumeEndTurnRequest,
    setLastTrailingWrapperUuid,
    consumeTurnState,
} from './bridge-state';

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
    consumeEndTurnRequest();
    // Drain any stale turn-state from a previous run that didn't clean up.
    consumeTurnState();

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
            consumeEndTurnRequest();
        }
    } catch (err) {
        if ((err as Error)?.name === 'AbortError') {
            // Cancelled — no rethrow.
        } else {
            throw err;
        }
    } finally {
        // Flush whatever we've accumulated for this turn even on early
        // exit. Better to record a partial closer than to leak stale
        // state into the next turn.
        await flushTurnState(args.chatId, args.userMessageId);
        currentAbort = null;
        setActiveChat(null);
        setCurrentSdkAssistantUuid(undefined);
        await rpcAnnounce(args.chatId, 'turn_ended');
    }

    return { ok: true, sessionId: capturedSessionId };
}

async function flushTurnState(chatId: string, userMessageId: string) {
    const { producedMessageIds, trailingWrapperUuid } = consumeTurnState();
    if (!trailingWrapperUuid) return;
    const messageIds = [userMessageId, ...producedMessageIds];
    await rpcAnnounceTurnClosed(chatId, messageIds, trailingWrapperUuid);
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
        case 'user': {
            // The SDK stream emits two flavors of user message we care about:
            //
            // (1) The main-thread user prompt (the one we sent).
            //     parent_tool_use_id === null, no tool_result content blocks.
            //     We record its UUID against our userMessageId so future
            //     forks can identify "this is the prompt we sent."
            //
            // (2) Tool-result wrappers built by the SDK to feed tool_use
            //     outputs back to the model. parent_tool_use_id === null on
            //     the main thread (parent_tool_use_id is the subagent
            //     boundary, NOT a tool_result discriminator — confirmed by
            //     reading sdk.mjs). Discriminated by tool_result blocks in
            //     content. Their UUIDs are the clean fork anchors at the
            //     end of an agent turn.
            //
            // Subagent-context messages (parent_tool_use_id !== null) are
            // filtered out — forkSession's lookup also filters isSidechain
            // before matching uuid.
            const parentToolUseId = (msg as unknown as { parent_tool_use_id: string | null }).parent_tool_use_id;
            const isSynthetic = (msg as unknown as { isSynthetic?: boolean }).isSynthetic === true;
            if (parentToolUseId !== null) return;

            const content = (msg.message as unknown as { content: unknown }).content;
            const isToolResultWrapper = Array.isArray(content) && content.some((b) =>
                typeof b === 'object' && b !== null && (b as { type?: string }).type === 'tool_result'
            );

            const uuid = msg.uuid as unknown as string | undefined;

            if (isToolResultWrapper) {
                // (2) — remember as candidate turn closer. The LAST wrapper
                // observed before the `result` message is the closer.
                if (uuid) setLastTrailingWrapperUuid(uuid);
                return;
            }

            if (isSynthetic) return;

            // (1) — the main-thread user prompt we sent.
            if (uuid) {
                await rpcRecordSdkUuid(args.chatId, args.userMessageId, uuid);
            }
            return;
        }
        case 'result': {
            // SDK loop settled. Flush turn closer to server now; the
            // finally block also flushes defensively, but doing it here
            // means the metadata stamp is visible before runAgentPrompt
            // returns.
            await flushTurnState(args.chatId, args.userMessageId);
            return;
        }
        default:
            return;
    }
}

export async function forkAndReturnNewSessionId(args: {
    sessionId: string;
    upToMessageId?: string;
}): Promise<{ newSessionId: string }> {
    const { sessionId } = await forkSession(args.sessionId, {
        ...(args.upToMessageId ? { upToMessageId: args.upToMessageId } : {}),
    });
    return { newSessionId: sessionId };
}
