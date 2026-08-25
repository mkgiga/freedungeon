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
    enableChoicePrompts?: boolean;
    enableSceneImages?: boolean;
    enableItemIcons?: boolean;
    claudeCliPath?: string | null;
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
    consumeTurnState();

    const abort = new AbortController();
    currentAbort = abort;

    const enableSceneImages = args.enableSceneImages ?? false;
    const mcpServer = buildGameStateMcpServer(args.enableChoicePrompts ?? false, enableSceneImages, args.enableItemIcons ?? false);

    let capturedSessionId: string | null = args.resumeSessionId;
    let caughtError: { name?: string; message: string } | null = null;

    const q = query({
        prompt: args.userContent,
        options: {
            abortController: abort,
            mcpServers: { game_state: mcpServer },
            allowedTools: allTools(enableSceneImages),
            tools: [],
            systemPrompt: args.systemPrompt,
            model: args.model,
            permissionMode: 'bypassPermissions',
            ...(args.resumeSessionId ? { resume: args.resumeSessionId } : {}),
            settingSources: [],
            persistSession: true,
            ...((args.claudeCliPath || process.env.CLAUDE_CLI_PATH)
                ? { pathToClaudeCodeExecutable: args.claudeCliPath || process.env.CLAUDE_CLI_PATH }
                : {}),
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
        try {
            await flushTurnState(args.chatId, args.userMessageId, capturedSessionId);
        } catch (flushErr) {
            console.error('flushTurnState failed:', flushErr);
        }
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

async function flushTurnState(chatId: string, userMessageId: string, fallbackSessionId: string | null) {
    const { producedMessageIds, trailingWrapperUuid, trailingWrapperSessionId } = consumeTurnState();
    if (!trailingWrapperUuid) return;
    const sessionId = trailingWrapperSessionId ?? fallbackSessionId;
    if (!sessionId) return;
    const messageIds = [userMessageId, ...producedMessageIds];
    await rpcAnnounceTurnClosed(chatId, messageIds, trailingWrapperUuid, sessionId);
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
            setCurrentSdkAssistantUuid(msg.uuid as unknown as string);
            return;
        }
        case 'user': {
            const parentToolUseId = (msg as unknown as { parent_tool_use_id: string | null }).parent_tool_use_id;
            const isSynthetic = (msg as unknown as { isSynthetic?: boolean }).isSynthetic === true;
            if (parentToolUseId !== null) return;

            const content = (msg.message as unknown as { content: unknown }).content;
            const isToolResultWrapper = Array.isArray(content) && content.some((b) =>
                typeof b === 'object' && b !== null && (b as { type?: string }).type === 'tool_result'
            );

            const uuid = msg.uuid as unknown as string | undefined;

            if (isToolResultWrapper) {
                if (uuid) {
                    const sid = (msg as unknown as { session_id?: string }).session_id;
                    setLastTrailingWrapperUuid(uuid, sid);
                }
                return;
            }

            if (isSynthetic) return;

            if (uuid) {
                await rpcRecordSdkUuid(args.chatId, args.userMessageId, uuid);
            }
            return;
        }
        case 'result': {
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

export type ScenarioPromptArgs = {
    chatId: string;
    userMessage: string;
    systemPrompt: string;
    model: string;
    history: Array<{ role: string; content: string }>;
    claudeCliPath?: string | null;
};

export type ScenarioPromptResult =
    | { ok: true; reply: string }
    | { ok: false; error: string };

/**
 * One collaborator exchange through the Claude SDK. No session resume, fork
 * anchors or produced-message bookkeeping - the collaborator writes directly to
 * actors and notes rather than emitting blocks, so there is no transcript to
 * keep in sync. History is replayed as plain text each turn.
 */
export async function runScenarioPrompt(args: ScenarioPromptArgs): Promise<ScenarioPromptResult> {
    const { buildScenarioMcpServer, scenarioAllowedTools } = await import('./scenario-mcp');

    const replayed = args.history
        .map(m => `${m.role === 'user' ? 'User' : 'You'}: ${m.content}`)
        .join('\n');
    const prompt = replayed
        ? `<conversation_so_far>\n${replayed}\n</conversation_so_far>\n\n<user>\n${args.userMessage}\n</user>`
        : args.userMessage;

    try {
        const q = query({
            prompt,
            options: {
                mcpServers: { scenario: buildScenarioMcpServer(args.chatId) },
                allowedTools: [...scenarioAllowedTools(), 'WebFetch'],
                tools: [],
                systemPrompt: args.systemPrompt,
                model: args.model,
                permissionMode: 'bypassPermissions',
                settingSources: [],
                persistSession: false,
                ...((args.claudeCliPath || process.env.CLAUDE_CLI_PATH)
                    ? { pathToClaudeCodeExecutable: args.claudeCliPath || process.env.CLAUDE_CLI_PATH }
                    : {}),
            },
        });

        let reply = '';
        for await (const msg of q) {
            if (msg.type === 'assistant') {
                for (const block of msg.message.content) {
                    if (block.type === 'text') reply += block.text;
                }
            }
        }
        return { ok: true, reply: reply.trim() };
    } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
}
