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
    /** Absolute path to the Claude CLI, resolved by the server per turn. */
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
    // Drain any stale turn-state from a previous run that didn't clean up.
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
            // The server resolves the CLI (its own download, or the user's
            // existing install) and sends the path with each turn. The env var
            // is only a fallback for a manually launched agent — without one of
            // them the SDK throws "Native CLI binary for <platform> not found".
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
        // Flush whatever we've accumulated for this turn even on early
        // exit. Better to record a partial closer than to leak stale
        // state into the next turn.
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
    // SDKUserMessage.session_id is optional on the stream emission; if no
    // wrapper this turn carried one, fall back to the session id we
    // captured from the `system: init` event. Either way, the closer
    // and the session_id agree on which session this turn lives in —
    // which is what findForkAnchorIn needs to filter stale closers
    // after a future fork rewrites session ids.
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
                if (uuid) {
                    const sid = (msg as unknown as { session_id?: string }).session_id;
                    setLastTrailingWrapperUuid(uuid, sid);
                }
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
            // Settlement is observed; the finally block in
            // runAgentPrompt does the actual flush so it has access to
            // capturedSessionId (a closure local of runAgentPrompt, not
            // visible here). The stream loop exits naturally after this
            // message, so the flush runs immediately.
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

// ─────────────────────────────────────────────────────────────────────────
// Scenario collaborator
// ─────────────────────────────────────────────────────────────────────────

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
 * One collaborator exchange through the Claude SDK.
 *
 * Deliberately much simpler than runAgentPrompt: no session resume, no fork
 * anchors, no produced-message bookkeeping. The collaborator writes directly to
 * actors and notes rather than emitting blocks, so there is no transcript to
 * keep in sync — history is replayed as plain text each turn.
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
                // Claude is the only provider with real browsing, so WebFetch is
                // allowed here and nowhere else. Other providers get the
                // registry's fetch_url, which returns an explanatory refusal.
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
