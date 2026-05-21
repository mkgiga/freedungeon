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

type RpcRequest = ExecRequest | QueryRequest | AnnouncementRequest | SdkUuidRequest;

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
    return c.json({ error: 'unknown_kind' }, 400);
});

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
 * Fork the SDK session to preserve cache up to a point. `keepUntilMessageId`
 * is one of OUR ChatMessage ids; we look up its sdkUuid from metadata and
 * fork the SDK session inclusive of that UUID. Returns the new session id
 * (also persisted to chat.agent_session_id) or null if no fork was possible.
 *
 * Fork is message-granular on the SDK side. If `keepUntilMessageId` is an
 * agent-emitted assistant block that shares its sdkUuid with later blocks
 * in the same agent turn, the entire turn is preserved together (we cannot
 * cut mid-turn). Callers should round to a user message for predictable
 * cutoffs.
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

    const keepMsg = state.currentChat.messages[args.keepUntilMessageId];
    const sdkUuid = keepMsg?.metadata?.sdkUuid as string | undefined;
    if (!sdkUuid) {
        log.server.warn(`No sdkUuid on message ${args.keepUntilMessageId}; falling back to invalidate`);
        await invalidateAgentSession(args.chatId);
        return null;
    }

    const response = await fetch(`${AGENT_URL}/fork`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: oldSessionId, upToMessageId: sdkUuid }),
    });
    if (!response.ok) {
        const errText = await response.text();
        log.server.error(`Fork failed: ${errText}; falling back to invalidate`);
        await invalidateAgentSession(args.chatId);
        return null;
    }
    const { newSessionId } = await response.json() as { newSessionId: string };
    await db.updateTable('chats')
        .set({ agent_session_id: newSessionId })
        .where('id', '=', args.chatId)
        .execute();
    log.server.info(`Forked agent session for chat ${args.chatId}: ${oldSessionId} -> ${newSessionId} @ ${sdkUuid}`);
    return newSessionId;
}
