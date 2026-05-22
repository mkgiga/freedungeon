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
    trailingWrapperSessionId: string;
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
    // Stamp metadata.sdkTurnCloserUuid AND sdkTurnCloserSessionId on
    // every message the agent produced during this turn (user prompt +
    // assistant blocks). The pair (uuid, sessionId) is the only clean
    // fork anchor we can rely on — it points to the tool_result wrapper
    // that closes the agent's turn in a SPECIFIC session's transcript.
    //
    // Tracking sessionId alongside is critical: forkSession rewrites
    // every kept entry's uuid in the resulting session. After a
    // successful fork, closer uuids stamped pre-fork become stale
    // pointers into the now-defunct prior session. findForkAnchorIn
    // filters by current sessionId to skip those stale entries.
    let stamped = 0;
    for (const messageId of req.messageIds) {
        const msg = state.currentChat.messages[messageId];
        if (!msg) continue;
        const nextMeta = {
            ...(msg.metadata ?? {}),
            sdkTurnCloserUuid: req.trailingWrapperUuid,
            sdkTurnCloserSessionId: req.trailingWrapperSessionId,
        };
        const updated = { ...msg, metadata: nextMeta, updatedAt: Date.now() };
        setState('currentChat', 'messages', messageId, updated);
        saveMessage(updated);
        stamped++;
    }
    log.server.info(`Turn closer ${req.trailingWrapperUuid.slice(0, 8)}… in session ${req.trailingWrapperSessionId.slice(0, 8)}… stamped on ${stamped}/${req.messageIds.length} messages for chat ${req.chatId}`);
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
            // Aliasing boundary: the agent-facing field is `id`, backed
            // by the DB's `Actor.customId` (user-authored, stable,
            // friendly). The nanoid `a.id` primary key is intentionally
            // never exposed to the agent — falls back to it only if
            // customId is somehow blank, as a last-resort identifier.
            id: a.customId || a.id,
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
        // Clear the rehydration warning now that a session exists — the
        // preamble has been baked into it, and future prompts resume
        // normally.
        if (state.currentChat.id === req.chatId && state.currentChat.agentRehydration !== null) {
            setState('currentChat', 'agentRehydration', null);
        }
        log.server.info(`Captured agent session ${req.sessionId} for chat ${req.chatId}`);
    }
    if (req.event === 'turn_ended') {
        setState('isGenerating', false);
        // Snapshot the post-turn flags so the NEXT prompt can diff
        // against them. Captures the agent's own set_flag/clear_flag
        // effects too — those will then NOT appear as deltas on the
        // next turn, since the snapshot already reflects them. Only
        // out-of-band changes (UI toggles, edits to prior messages
        // that re-replay differently) will surface as deltas.
        if (state.currentChat.id === req.chatId) {
            void writeFlagsSnapshot(req.chatId, state.currentChat.gameState.flags);
        }
    }
    return { ok: true };
}

async function writeFlagsSnapshot(chatId: string, flags: Record<string, unknown>) {
    try {
        await db.updateTable('chats')
            .set({ last_agent_flags_snapshot: JSON.stringify(flags) })
            .where('id', '=', chatId)
            .execute();
    } catch (err) {
        log.server.error(`Failed to snapshot flags for chat ${chatId}: ${err instanceof Error ? err.message : String(err)}`);
    }
}

/**
 * Reset a chat's flags snapshot to the current state. Call after
 * destructive ops (regen, rewind) that re-replay history and change
 * what the agent's "last visible state" should be — without this, the
 * next prompt's delta would compare against a snapshot from a now-
 * pruned reality and produce noise.
 */
export async function resetFlagsSnapshotToCurrent(chatId: string) {
    if (state.currentChat.id !== chatId) return;
    await writeFlagsSnapshot(chatId, state.currentChat.gameState.flags);
}

/**
 * Build a delta string from a snapshot (the post-turn flags from the
 * end of the previous turn) and the current flags. Returns an empty
 * string if nothing changed — the caller should then skip injecting
 * the <state_changes_since_last_turn> block entirely.
 */
function buildFlagsDelta(
    snapshot: Record<string, unknown> | null,
    current: Record<string, unknown>,
): string {
    if (snapshot === null) return ''; // no baseline yet (fresh chat, post-fork, post-clone) — treat current as the baseline
    const lines: string[] = [];
    for (const [key, val] of Object.entries(current)) {
        if (!(key in snapshot)) {
            lines.push(`- flag "${key}" added (value: ${JSON.stringify(val)})`);
        } else if (JSON.stringify(snapshot[key]) !== JSON.stringify(val)) {
            lines.push(`- flag "${key}" changed: ${JSON.stringify(snapshot[key])} -> ${JSON.stringify(val)}`);
        }
    }
    for (const key of Object.keys(snapshot)) {
        if (!(key in current)) {
            lines.push(`- flag "${key}" removed`);
        }
    }
    return lines.join('\n');
}

// ─────────────────────────────────────────────────────────────────────────
// Server → Agent: prompt forwarding
// ─────────────────────────────────────────────────────────────────────────

/**
 * Wrap the user input with a <system_notice> block carrying
 * out-of-band state updates. The Anthropic API has no system-role
 * channel within the messages array, so by convention the SDK ferries
 * server-originated, non-user instruction-context inside a user-role
 * message tagged with a known XML wrapper. The system prompt teaches
 * the agent to treat <system_notice> content as authoritative state
 * updates, distinct from the user's actual <current_input>.
 */
function wrapWithSystemNotice(noticeBody: string, userContent: string): string {
    return [
        '<system_notice>',
        'State changes occurred outside the agent loop since the previous turn. Treat these as ground truth:',
        '',
        noticeBody,
        '</system_notice>',
        '',
        userContent,
    ].join('\n');
}

/**
 * Wrap the new user input with a replayed-history preamble built from
 * the chat's persisted ChatMessages (excluding the just-added prompt).
 * Returns the bare input unchanged if there's no prior history.
 *
 * The preamble uses XML-style tags the system prompt is aware of:
 *
 *   <replayed_history>...</replayed_history>
 *   <current_input>...</current_input>
 *
 * Consecutive same-role messages are grouped into one section to keep
 * the preamble compact. ChatMessage.content is the serialized block(s)
 * exactly as they live in the DB — the agent reads them as the source
 * of truth, and queries like list_active_actors return the cumulative
 * state from the deterministic replay so the agent can cross-check.
 */
function wrapWithHistoryPreamble(
    allMessages: import('@shared/types').ChatMessage[],
    excludeMessageId: string,
    newUserContent: string,
): string {
    const prior = allMessages
        .filter(m => m.id !== excludeMessageId)
        .sort((a, b) => (a.createdAt - b.createdAt) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

    if (prior.length === 0) return newUserContent;

    const sections: string[] = [];
    let runRole: string | null = null;
    let runLines: string[] = [];

    const flush = () => {
        if (runRole === null || runLines.length === 0) return;
        const tag = runRole === 'user' ? 'user' : 'agent';
        sections.push(`[${tag}]\n${runLines.join('\n')}`);
        runLines = [];
    };

    for (const msg of prior) {
        if (msg.role !== runRole) {
            flush();
            runRole = msg.role;
        }
        runLines.push(msg.content);
    }
    flush();

    return [
        '<replayed_history>',
        'The simulation has been running. The following events have already occurred — your memory of the conversation so far, reconstructed from persisted records. They are ground truth; the current game state (queryable via the read tools) reflects their cumulative effect. Do NOT respond to them as if they are happening now.',
        '',
        sections.join('\n\n'),
        '</replayed_history>',
        '',
        '<current_input>',
        newUserContent,
        '</current_input>',
    ].join('\n');
}

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

    // When there's no SDK session to resume — pre-MCP chats, branched/
    // cloned chats whose source had no session, anything orphaned by
    // session-file loss — synthesize a context preamble from the chat's
    // persisted ChatMessages and prepend it to the user's input. The
    // SDK creates a new session containing that preamble + the new
    // prompt; the resulting session_id is captured and saved, and every
    // subsequent prompt resumes normally from there. So this expensive
    // preamble happens at most ONCE per chat (or once per re-orphaning).
    let userContent = resumeSessionId === null
        ? wrapWithHistoryPreamble(
            Object.values(state.currentChat.messages),
            args.userMessageId,
            args.userContent,
        )
        : args.userContent;

    // Diff flags since the end of the previous turn and prepend a
    // <system_notice> block if anything has changed out-of-band (user
    // toggles, prior-message edits that re-replayed differently). The
    // Anthropic API has no mid-conversation system-role channel — every
    // message is user or assistant — so the convention is to mark
    // instruction-like content with an XML tag the model recognizes as
    // distinct from user dialogue. RP_PROMPT.md teaches the agent that
    // <system_notice> blocks are out-of-band state updates, not user
    // input.
    const flagsSnapshotRow = await db.selectFrom('chats')
        .select('last_agent_flags_snapshot')
        .where('id', '=', args.chatId)
        .executeTakeFirst();
    const flagsSnapshot = flagsSnapshotRow?.last_agent_flags_snapshot
        ? JSON.parse(flagsSnapshotRow.last_agent_flags_snapshot) as Record<string, unknown>
        : null;
    const flagsDelta = buildFlagsDelta(flagsSnapshot, state.currentChat.gameState.flags);
    if (flagsDelta) {
        userContent = wrapWithSystemNotice(flagsDelta, userContent);
    }

    setState('isGenerating', true);

    let response: Response;
    try {
        response = await fetch(`${AGENT_URL}/prompt`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chatId: args.chatId,
                userMessageId: args.userMessageId,
                userContent,
                systemPrompt: expandedSystemPrompt,
                resumeSessionId,
                model: llmConfig.model || 'claude-sonnet-4-6',
            }),
        });
    } catch (err) {
        // Network-level failure: agent process unreachable, crashed,
        // restarted mid-request. The caller (generateResponse) clears
        // isGenerating in its finally and notifies the user.
        throw new Error(`Agent unreachable: ${err instanceof Error ? err.message : String(err)}`);
    }

    if (!response.ok) {
        // The agent now always returns 200 with a structured body, so
        // a non-OK status means something the agent itself couldn't
        // catch — defensive only.
        const errText = await response.text().catch(() => '');
        throw new Error(`Agent transport error ${response.status}: ${errText.slice(0, 200)}`);
    }

    // Structured result from runAgentPrompt: { ok, sessionId, error?, errorName?, aborted? }.
    // ok=false means an internal agent failure (SDK Overloaded, transport
    // closed, etc.) that the agent caught cleanly. Surface to the
    // caller as a thrown Error so generateResponse's catch can notify
    // the user.
    const result = await response.json().catch(() => ({ ok: false, error: 'invalid agent response body' })) as
        | { ok: true; sessionId: string | null; aborted?: boolean }
        | { ok: false; sessionId: string | null; error: string; errorName?: string };
    if (!result.ok) {
        throw new Error(`Agent reported failure${result.errorName ? ` (${result.errorName})` : ''}: ${result.error}`);
    }
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

/**
 * Drop a chat's SDK session and arm the rehydration path. The next
 * prompt will inject the chat's full message history as a preamble
 * into a fresh session so the agent's view stays in sync with the
 * displayed chat. Used as the fork-failure / no-anchor fallback —
 * preferred over "leave session intact" because divergence causes the
 * agent to ignore events the user can see (e.g. characters
 * pretending events didn't happen).
 *
 * When the dropped chat is the loaded one and has any messages, sets
 * the rehydration flag so the UI shows the warning + cost-confirm
 * modal on the next send.
 */
export async function invalidateAgentSession(chatId: string) {
    await db.updateTable('chats')
        .set({ agent_session_id: null })
        .where('id', '=', chatId)
        .execute();
    if (state.currentChat.id === chatId) {
        const msgs = Object.values(state.currentChat.messages);
        if (msgs.length > 0) {
            const chars = msgs.reduce((sum, m) => sum + m.content.length, 0);
            setState('currentChat', 'agentRehydration', {
                messageCount: msgs.length,
                estimatedTokens: Math.ceil(chars / 4),
            });
        }
    }
    log.server.info(`Invalidated agent session for chat ${chatId}`);
}

/**
 * Find a clean fork anchor (an SDK tool_result wrapper UUID) within a
 * given message dictionary, scoped to a specific SDK session. Walks
 * backward from `keepUntilMessageId` through the sorted messages,
 * returning the first metadata.sdkTurnCloserUuid whose recorded
 * sdkTurnCloserSessionId matches `currentSessionId`.
 *
 * Why the session filter matters: forkSession rewrites every kept
 * entry's uuid in the resulting session. After a successful fork,
 * closer uuids stamped pre-fork still refer to the OLD session and are
 * not addressable in the new one. Without this filter, walking back
 * would return a stale uuid and the next forkSession call would error
 * with "Message X not found in session Y".
 *
 * `keepUntilMessageId` itself counts as the starting point — if that
 * message has a matching closer, we use it. Otherwise we step back.
 *
 * Returns null when no matching anchor exists. Callers MUST handle
 * null by leaving the session untouched rather than invalidating.
 *
 * Takes a messages dict argument rather than reading from
 * state.currentChat so it can be used for cross-chat operations
 * (branching from a source chat whose messages haven't been loaded
 * into currentChat).
 */
function findForkAnchorIn(
    messages: Record<string, import('@shared/types').ChatMessage>,
    keepUntilMessageId: string,
    currentSessionId: string
): string | null {
    const sorted = Object.values(messages)
        .sort((a, b) => (a.createdAt - b.createdAt) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const cutoffIdx = sorted.findIndex(m => m.id === keepUntilMessageId);
    if (cutoffIdx === -1) return null;
    let staleSkipped = 0;
    for (let i = cutoffIdx; i >= 0; i--) {
        const meta = sorted[i]?.metadata;
        const closer = meta?.sdkTurnCloserUuid as string | undefined;
        const sessionId = meta?.sdkTurnCloserSessionId as string | undefined;
        if (!closer) continue;
        if (sessionId !== currentSessionId) {
            staleSkipped++;
            continue;
        }
        if (staleSkipped > 0) {
            log.server.info(`findForkAnchor skipped ${staleSkipped} stale closer(s) from prior sessions before matching session ${currentSessionId.slice(0, 8)}…`);
        }
        return closer;
    }
    if (staleSkipped > 0) {
        log.server.info(`findForkAnchor found ${staleSkipped} stale closer(s) but none matched session ${currentSessionId.slice(0, 8)}…; returning null`);
    }
    return null;
}

/**
 * Fork the SDK session to preserve cache up to (and including) a clean
 * turn boundary at or before `keepUntilMessageId`. On success persists
 * the new session id to `chat.agent_session_id` and returns it.
 *
 * On any failure (no anchor in the current session, fork call errored)
 * the session is INVALIDATED so the next prompt rebuilds context from
 * the displayed chat via rehydration. The invalidate path is preferred
 * over "leave session intact" because divergence between displayed
 * messages and SDK transcript causes the agent to ignore events the
 * user can see (characters pretending events that just happened
 * didn't). Rehydration costs a one-time preamble; divergence costs
 * trust in the chat.
 *
 * The one case where we do nothing: no source session at all. Then
 * the chat is ALREADY in the rehydration state and the next prompt
 * will inject the preamble naturally.
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
        log.server.info(`No agent session to fork for chat ${args.chatId}; first prompt will rehydrate`);
        return null;
    }

    const anchor = findForkAnchorIn(state.currentChat.messages, args.keepUntilMessageId, oldSessionId);
    if (!anchor) {
        log.server.warn(`No fork anchor in session ${oldSessionId.slice(0, 8)}… at or before ${args.keepUntilMessageId} for chat ${args.chatId}; invalidating session, next prompt will rehydrate`);
        await invalidateAgentSession(args.chatId);
        return null;
    }

    const response = await fetch(`${AGENT_URL}/fork`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: oldSessionId, upToMessageId: anchor }),
    });
    if (!response.ok) {
        const errText = await response.text();
        log.server.error(`Fork failed: ${errText}; invalidating session for chat ${args.chatId}, next prompt will rehydrate`);
        await invalidateAgentSession(args.chatId);
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
        const found = findForkAnchorIn(args.sourceMessages, args.keepUntilMessageId, sourceSessionId);
        if (!found) {
            log.server.warn(`Source chat ${args.sourceChatId} has no anchor in session ${sourceSessionId.slice(0, 8)}… at ${args.keepUntilMessageId}; ${args.targetChatId} starts fresh (will rehydrate on first prompt)`);
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
