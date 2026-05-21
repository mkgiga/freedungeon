import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { nanoid } from 'nanoid';
import { Hono } from 'hono';
import { COMMANDS, type CommandName } from '@shared/game-state/commands';
import { QUERIES, type QueryName } from '@shared/game-state/queries';
import { applyBlockToCtx } from '@shared/game-state';
import { serializeBlocks } from '@shared/blocks';
import { state, setState } from './server';
import { db, saveMessage } from './db';
import { parseMacros } from './macro';
import { runTurn, setCurrentTurnResult } from './game-state';
import { log } from './logger';

const AGENT_PORT = Number(process.env.AGENT_PORT ?? 8076);
const AGENT_URL = `http://127.0.0.1:${AGENT_PORT}`;

let agentProcess: ChildProcess | null = null;

/**
 * Spawn the agent process as a child of the server. Owning the lifecycle here
 * means the agent dies with the server (and restarts if we ever crash-loop
 * it). The agent listens on AGENT_PORT and we call into it via HTTP.
 */
export function spawnAgentProcess() {
    if (agentProcess) return;
    const agentDir = path.join(import.meta.dirname, '..', '..', 'agent-claude');
    log.server.info(`Spawning agent process from ${agentDir} on port ${AGENT_PORT}...`);
    const proc = spawn('bun', ['run', 'index.ts'], {
        cwd: agentDir,
        env: {
            ...process.env,
            AGENT_PORT: String(AGENT_PORT),
            SERVER_RPC_URL: `http://127.0.0.1:${process.env.SERVER_PORT ?? 8078}/agent-rpc`,
        },
        stdio: 'inherit',
    });
    proc.on('exit', (code) => {
        log.server.warn(`Agent process exited with code ${code}`);
        agentProcess = null;
    });
    proc.on('error', (err) => {
        log.server.error(`Agent process error: ${err.message}`);
    });
    agentProcess = proc;
}

export function killAgentProcess() {
    if (agentProcess) {
        agentProcess.kill('SIGTERM');
        agentProcess = null;
    }
}

// ─────────────────────────────────────────────────────────────────────────
// Agent RPC — endpoints the agent process calls into
// ─────────────────────────────────────────────────────────────────────────

type ExecRequest = {
    kind: 'exec';
    chatId: string;
    command: CommandName;
    args: Record<string, unknown>;
    sdkUuid?: string;
};

type QueryRequest = {
    kind: 'query';
    chatId: string;
    query: QueryName;
    args: Record<string, unknown>;
};

type AnnouncementRequest = {
    kind: 'announce';
    chatId: string;
    sessionId?: string;
    event: 'turn_started' | 'turn_ended' | 'session_captured';
};

type SdkUuidRequest = {
    kind: 'sdk_uuid';
    chatId: string;
    messageId: string;
    sdkUuid: string;
};

type TurnClosedRequest = {
    kind: 'turn_closed';
    chatId: string;
    messageIds: string[];
    trailingWrapperUuid: string;
};

type RpcRequest = ExecRequest | QueryRequest | AnnouncementRequest | SdkUuidRequest | TurnClosedRequest;

export const agentRpcRouter = new Hono();

agentRpcRouter.post('/', async (c) => {
    let body: RpcRequest;
    try {
        body = await c.req.json();
    } catch {
        return c.json({ error: 'invalid_json' }, 400);
    }

    if (body.kind === 'exec') return c.json(handleExec(body));
    if (body.kind === 'query') return c.json(handleQuery(body));
    if (body.kind === 'announce') return c.json(handleAnnounce(body));
    if (body.kind === 'sdk_uuid') return c.json(handleSdkUuid(body));
    if (body.kind === 'turn_closed') return c.json(handleTurnClosed(body));
    return c.json({ error: 'unknown_kind' }, 400);
});

function handleTurnClosed(req: TurnClosedRequest) {
    // Stamp metadata.sdkTurnCloserUuid on every message the agent
    // produced during this turn (user prompt + assistant blocks). That
    // UUID is the only clean fork anchor we can rely on — it points to
    // the tool_result wrapper that closes the agent's turn in the SDK
    // transcript, after which the next prompt can land cleanly.
    let stamped = 0;
    for (const messageId of req.messageIds) {
        const msg = state.currentChat.messages[messageId];
        if (!msg) continue;
        const nextMeta = { ...(msg.metadata ?? {}), sdkTurnCloserUuid: req.trailingWrapperUuid };
        const updated = { ...msg, metadata: nextMeta, updatedAt: Date.now() };
        setState('currentChat', 'messages', messageId, updated);
        saveMessage(updated);
        stamped++;
    }
    log.server.info(`Turn closer ${req.trailingWrapperUuid.slice(0, 8)}… stamped on ${stamped}/${req.messageIds.length} messages for chat ${req.chatId}`);
    return { ok: true, stamped };
}

function handleSdkUuid(req: SdkUuidRequest) {
    const msg = state.currentChat.messages[req.messageId];
    if (!msg) return { error: 'message_not_found' };
    const nextMeta = { ...(msg.metadata ?? {}), sdkUuid: req.sdkUuid };
    const updated = { ...msg, metadata: nextMeta, updatedAt: Date.now() };
    setState('currentChat', 'messages', req.messageId, updated);
    saveMessage(updated);
    return { ok: true };
}

function handleExec(req: ExecRequest) {
    const spec = COMMANDS[req.command];
    if (!spec) return { error: `unknown_command: ${req.command}` };

    const parsed = spec.schema.safeParse(req.args);
    if (!parsed.success) {
        return { error: `invalid_args: ${parsed.error.message}` };
    }

    if (state.currentChat.id !== req.chatId) {
        return { error: `chat_mismatch: agent is acting on ${req.chatId} but server's current chat is ${state.currentChat.id}` };
    }

    // Zod has already validated the args against this spec's schema; the
    // any-cast is needed because TS can't narrow toBlock's union signature
    // back to its origin spec when COMMANDS is iterated as a union map.
    const block = (spec.toBlock as (a: unknown) => ReturnType<typeof spec.toBlock>)(parsed.data);
    const effects: string[] = [];
    const ctxBefore = JSON.parse(JSON.stringify(state.currentChat.gameState));
    applyBlockToCtx(state.currentChat.gameState, block, effects);
    setState('currentChat', 'gameState', state.currentChat.gameState);

    const messageId = nanoid();
    const now = Date.now();
    const serialized = serializeBlocks([block]);

    const metadata: Record<string, unknown> = { agent: true };
    if (req.sdkUuid) metadata.sdkUuid = req.sdkUuid;

    const message = {
        id: messageId,
        role: 'assistant' as const,
        chatId: req.chatId,
        content: serialized,
        createdAt: now,
        updatedAt: now,
        metadata,
    };
    setState('currentChat', 'messages', messageId, message);
    saveMessage(message);

    return {
        ok: true,
        messageId,
        effects: effects.length > 0 ? effects.join('\n') : describeNoOp(req.command, parsed.data, ctxBefore, state.currentChat.gameState),
    };
}

function describeNoOp(command: string, args: any, ctxBefore: any, ctxAfter: any): string {
    if (JSON.stringify(ctxBefore) === JSON.stringify(ctxAfter)) {
        return `${command} accepted (no state change). args: ${JSON.stringify(args)}`;
    }
    return `${command} accepted. args: ${JSON.stringify(args)}`;
}

function handleQuery(req: QueryRequest) {
    const spec = QUERIES[req.query];
    if (!spec) return { error: `unknown_query: ${req.query}` };

    const parsed = spec.schema.safeParse(req.args);
    if (!parsed.success) {
        return { error: `invalid_args: ${parsed.error.message}` };
    }

    if (state.currentChat.id !== req.chatId) {
        return { error: `chat_mismatch: agent is querying ${req.chatId} but server's current chat is ${state.currentChat.id}` };
    }

    const actors = state.currentChat.assets.actors
        .map((id) => state.assets.actors[id])
        .filter((a): a is NonNullable<typeof a> => Boolean(a))
        .map((a) => ({
            customId: a.customId || a.id,
            name: a.name,
            description: a.description,
            expressions: Object.keys(a.expressions),
            group: a.group,
        }));

    const notes = state.currentChat.assets.notes
        .map((id) => state.assets.notes[id])
        .filter((n): n is NonNullable<typeof n> => Boolean(n))
        .filter((n) => state.currentChat.hotbarNotes[n.id]?.enabled !== false)
        .map((n) => ({ title: n.title, type: n.type, content: n.content }));

    const deps = {
        ctx: state.currentChat.gameState,
        actors,
        notes,
    };

    // Cast around the same union-of-generic narrowing limitation as toBlock above.
    const result = (spec.run as (a: unknown, d: typeof deps) => string)(parsed.data, deps);
    return { ok: true, result };
}

function handleAnnounce(req: AnnouncementRequest) {
    if (req.event === 'session_captured' && req.sessionId) {
        db.updateTable('chats')
            .set({ agent_session_id: req.sessionId })
            .where('id', '=', req.chatId)
            .execute();
        log.server.info(`Captured agent session ${req.sessionId} for chat ${req.chatId}`);
    }
    if (req.event === 'turn_ended') {
        setState('isGenerating', false);
    }
    return { ok: true };
}

// ─────────────────────────────────────────────────────────────────────────
// Server → Agent: prompt forwarding
// ─────────────────────────────────────────────────────────────────────────

export async function dispatchPromptToAgent(args: {
    chatId: string;
    userMessageId: string;
    userContent: string;
}) {
    const llmConfig = state.assets.llmConfigs[state.userPreferences.activeLLMConfigId!];
    if (!llmConfig) throw new Error('No active LLM config selected');

    // Re-run replay so any state effects from the just-appended user message
    // are visible to the agent's queries from the very first tool call.
    const turnResult = runTurn(Object.values(state.currentChat.messages));
    setState('currentChat', 'gameState', turnResult.ctx);
    setCurrentTurnResult(turnResult);

    let expandedSystemPrompt = '';
    try {
        expandedSystemPrompt = parseMacros(llmConfig.systemPrompt ?? '');
    } finally {
        setCurrentTurnResult(null);
    }

    const sessionRow = await db.selectFrom('chats')
        .select('agent_session_id')
        .where('id', '=', args.chatId)
        .executeTakeFirst();
    const resumeSessionId = sessionRow?.agent_session_id ?? null;

    setState('isGenerating', true);

    const response = await fetch(`${AGENT_URL}/prompt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            chatId: args.chatId,
            userMessageId: args.userMessageId,
            userContent: args.userContent,
            systemPrompt: expandedSystemPrompt,
            resumeSessionId,
            model: llmConfig.model || 'claude-sonnet-4-6',
        }),
    });

    if (!response.ok) {
        setState('isGenerating', false);
        const errText = await response.text();
        throw new Error(`Agent error ${response.status}: ${errText}`);
    }

    // Agent responds when the turn ends. Server already received tool-call
    // RPCs to apply Blocks during the turn, so there's nothing to do with
    // the response body beyond logging it.
    const result = await response.json().catch(() => ({}));
    log.server.info(`Agent turn complete for chat ${args.chatId}: ${JSON.stringify(result).slice(0, 200)}`);
}

export async function cancelAgentTurn() {
    try {
        const response = await fetch(`${AGENT_URL}/cancel`, { method: 'POST' });
        if (!response.ok) {
            log.server.warn(`Agent cancel returned ${response.status}`);
        }
    } catch (err) {
        log.server.error(`Agent cancel failed: ${err instanceof Error ? err.message : String(err)}`);
    }
}

export async function invalidateAgentSession(chatId: string) {
    await db.updateTable('chats')
        .set({ agent_session_id: null })
        .where('id', '=', chatId)
        .execute();
    log.server.info(`Invalidated agent session for chat ${chatId}`);
}

/**
 * Find a clean fork anchor (an SDK tool_result wrapper UUID) within a
 * given message dictionary. Walks backward from `keepUntilMessageId`
 * through the sorted messages, returning the first
 * metadata.sdkTurnCloserUuid encountered.
 *
 * `keepUntilMessageId` itself counts as the starting point — if that
 * message has a closer, we use it. Otherwise we step back.
 *
 * Returns null when no anchor exists (e.g. the chat starts at this
 * message or no prior turn has been stamped yet). Callers MUST handle
 * null by leaving the session untouched rather than invalidating.
 *
 * Takes a messages dict argument rather than reading from
 * state.currentChat so it can be used for cross-chat operations
 * (branching from a source chat whose messages haven't been loaded
 * into currentChat).
 */
function findForkAnchorIn(
    messages: Record<string, import('@shared/types').ChatMessage>,
    keepUntilMessageId: string
): string | null {
    const sorted = Object.values(messages)
        .sort((a, b) => (a.createdAt - b.createdAt) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const cutoffIdx = sorted.findIndex(m => m.id === keepUntilMessageId);
    if (cutoffIdx === -1) return null;
    for (let i = cutoffIdx; i >= 0; i--) {
        const closer = sorted[i]?.metadata?.sdkTurnCloserUuid as string | undefined;
        if (closer) return closer;
    }
    return null;
}

/**
 * Fork the SDK session to preserve cache up to (and including) a clean
 * turn boundary at or before `keepUntilMessageId`. On success persists
 * the new session id to `chat.agent_session_id` and returns it.
 *
 * On any failure (no source session, no anchor, fork call errored) the
 * existing session is LEFT UNCHANGED. The displayed history may diverge
 * from the SDK transcript afterward but the agent never loses memory —
 * that trade is intentional. The prior "invalidate on failure" path
 * caused the agent to forget everything, which is much worse.
 */
export async function forkAgentSession(args: {
    chatId: string;
    keepUntilMessageId: string;
}): Promise<string | null> {
    const sessionRow = await db.selectFrom('chats')
        .select('agent_session_id')
        .where('id', '=', args.chatId)
        .executeTakeFirst();
    const oldSessionId = sessionRow?.agent_session_id;
    if (!oldSessionId) {
        log.server.info(`No agent session to fork for chat ${args.chatId}`);
        return null;
    }

    const anchor = findForkAnchorIn(state.currentChat.messages, args.keepUntilMessageId);
    if (!anchor) {
        log.server.warn(`No fork anchor found at or before message ${args.keepUntilMessageId} for chat ${args.chatId}; leaving session intact`);
        return null;
    }

    const response = await fetch(`${AGENT_URL}/fork`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: oldSessionId, upToMessageId: anchor }),
    });
    if (!response.ok) {
        const errText = await response.text();
        log.server.error(`Fork failed: ${errText}; leaving session intact for chat ${args.chatId}`);
        return null;
    }
    const { newSessionId } = await response.json() as { newSessionId: string };
    await db.updateTable('chats')
        .set({ agent_session_id: newSessionId })
        .where('id', '=', args.chatId)
        .execute();
    log.server.info(`Forked agent session for chat ${args.chatId}: ${oldSessionId} -> ${newSessionId} @ ${anchor.slice(0, 8)}…`);
    return newSessionId;
}

/**
 * Fork the source chat's SDK session and assign the resulting fork to
 * `targetChatId`. Used by branch / clone / saveAsTemplate so derived
 * chats inherit the agent's memory of the source.
 *
 * Three modes:
 *
 * - `mode: 'fullCopy'` — fork the entire source session (no
 *   upToMessageId). Use for clone/template flows where the derived chat
 *   is the complete contents of the source.
 *
 * - `mode: 'untilMessage'` — fork at the turn-closer anchor at or
 *   before `keepUntilMessageId`. Use for branch flows. The anchor is
 *   resolved against `sourceMessages` (which must contain
 *   keepUntilMessageId — typically the source chat's messages BEFORE
 *   they're cloned with new ids).
 *
 * Returns null when there's no source session, no anchor found, or the
 * fork call failed. In those cases the derived chat is left with
 * agent_session_id = null and its first prompt creates a fresh session.
 */
export async function forkAgentSessionForChat(
    args:
        | { sourceChatId: string; targetChatId: string; mode: 'fullCopy' }
        | { sourceChatId: string; targetChatId: string; mode: 'untilMessage';
            sourceMessages: Record<string, import('@shared/types').ChatMessage>;
            keepUntilMessageId: string }
): Promise<string | null> {
    const sourceRow = await db.selectFrom('chats')
        .select('agent_session_id')
        .where('id', '=', args.sourceChatId)
        .executeTakeFirst();
    const sourceSessionId = sourceRow?.agent_session_id;
    if (!sourceSessionId) {
        log.server.info(`Source chat ${args.sourceChatId} has no agent session; ${args.targetChatId} starts fresh`);
        return null;
    }

    let anchor: string | undefined = undefined;
    if (args.mode === 'untilMessage') {
        const found = findForkAnchorIn(args.sourceMessages, args.keepUntilMessageId);
        if (!found) {
            log.server.warn(`Source chat ${args.sourceChatId} has no fork anchor at ${args.keepUntilMessageId}; ${args.targetChatId} starts fresh`);
            return null;
        }
        anchor = found;
    }

    const response = await fetch(`${AGENT_URL}/fork`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            sessionId: sourceSessionId,
            ...(anchor ? { upToMessageId: anchor } : {}),
        }),
    });
    if (!response.ok) {
        const errText = await response.text();
        log.server.error(`Fork failed for ${args.sourceChatId} -> ${args.targetChatId}: ${errText}`);
        return null;
    }
    const { newSessionId } = await response.json() as { newSessionId: string };
    await db.updateTable('chats')
        .set({ agent_session_id: newSessionId })
        .where('id', '=', args.targetChatId)
        .execute();
    log.server.info(`Forked session ${sourceSessionId} -> ${newSessionId} for ${args.sourceChatId} -> ${args.targetChatId}${anchor ? ` @ ${anchor.slice(0, 8)}…` : ' (full copy)'}`);
    return newSessionId;
}
