import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { nanoid } from 'nanoid';
import { Hono } from 'hono';
import { COMMANDS, type CommandName } from '@shared/game-state/commands';
import { QUERIES, type QueryName } from '@shared/game-state/queries';
import { applyBlockToCtx } from '@shared/game-state';
import { parseBlocks, serializeBlocks } from '@shared/blocks';
import { mutate, state } from './server';
import { db } from './db';
import { parseMacros, MULTICHOICE_PROMPT_INSTRUCTIONS } from './macro';
import { featureEnabled } from '@shared/features';
import { visible } from '@shared/visibility';
import { queueItemIcon, itemIconsEnabled, generateSceneImage, sceneImagesEnabled, type ImageAspect } from './item-icons';
import { runTurn, setCurrentTurnResult } from './game-state';
import { normalizeModelMessage } from './game-state/debug';
import { log } from './logger';
import { isEmbedded } from './embedded';
import { dependencyPath, verifyDependency } from './dependencies';
import { ActionableError } from './notifications';
import { DEPENDENCIES } from '@shared/dependencies';
import { getDefaultSystemPrompt } from './system-prompt';
import { runScenarioTool } from './scenario-agent';
import type { ScenarioToolName } from '@shared/scenario-agent/tools';
import type { ModelMessage } from 'ai';
import type { GameStateContext, LLMConfig } from '@shared/types';
// In-process OpenAI-v1 loop. Note: ai-agent.ts imports execCommand/runQuery from
// here, forming a cycle — benign because both sides only call across it inside
// function bodies (hoisted `export function` bindings resolve via ESM live
// bindings). Extracting the executors to a dedicated module would remove it.
import { runAiSdkTurn, loadAiTranscript, saveAiTranscript } from './ai-agent';

const AGENT_PORT = Number(process.env.AGENT_PORT ?? 8076);
const AGENT_URL = `http://127.0.0.1:${AGENT_PORT}`;

let agentProcess: ChildProcess | null = null;

/**
 * Spawn the agent process as a child of the server. Owning the lifecycle here
 * means the agent dies with the server (and restarts if we ever crash-loop
 * it). The agent listens on AGENT_PORT and we call into it via HTTP.
 */
export async function spawnAgentProcess() {
    if (agentProcess) return;

    // A compiled binary has no agent-claude source tree to point `bun` at, and
    // no `bun` on the user's machine either — the agent is bundled into this
    // same executable, so re-exec ourselves with a flag that routes to it.
    const [command, args, cwd] = isEmbedded()
        ? [process.execPath, ['--agent'], undefined]
        : ['bun', ['run', 'index.ts'], path.join(import.meta.dirname, '..', '..', 'integrations', 'agent-claude')];

    // May be null on a first run that has never used an Anthropic config; the
    // SDK only needs it once such a config actually drives a turn, and
    // restartAgentProcess picks it up after the download completes.
    const claudeCli = await dependencyPath('claudeCli');

    log.server.info(`Spawning agent process${cwd ? ` from ${cwd}` : ''} on port ${AGENT_PORT}...`);
    const proc = spawn(command, args, {
        cwd,
        env: {
            ...process.env,
            AGENT_PORT: String(AGENT_PORT),
            // Must track --port, or the agent calls back to the wrong server.
            SERVER_RPC_URL: `http://127.0.0.1:${process.env.FREEDUNGEON_PORT ?? process.env.SERVER_PORT ?? 8078}/agent-rpc`,
            ...(claudeCli ? { CLAUDE_CLI_PATH: claudeCli } : {}),
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

/**
 * Restart the agent so it picks up a newly-downloaded CLI. The path is passed
 * through the environment at spawn time, so a process started before the
 * download would otherwise keep running without it.
 */
export async function restartAgentProcess() {
    killAgentProcess();
    await spawnAgentProcess();
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

/** One Scenario collaborator tool call, proxied from the Claude subprocess. */
type ScenarioRequest = {
    kind: 'scenario';
    chatId: string;
    tool: string;
    args: Record<string, unknown>;
};

type RpcRequest = ExecRequest | QueryRequest | AnnouncementRequest | SdkUuidRequest | TurnClosedRequest | ScenarioRequest;

export const agentRpcRouter = new Hono();

agentRpcRouter.post('/', async (c) => {
    let body: RpcRequest;
    try {
        body = await c.req.json();
    } catch {
        return c.json({ error: 'invalid_json' }, 400);
    }

    if (body.kind === 'exec') return c.json(await handleExec(body));
    if (body.kind === 'query') return c.json(handleQuery(body));
    if (body.kind === 'announce') return c.json(handleAnnounce(body));
    if (body.kind === 'sdk_uuid') return c.json(handleSdkUuid(body));
    if (body.kind === 'turn_closed') return c.json(handleTurnClosed(body));
    if (body.kind === 'scenario') {
        return c.json(await runScenarioTool(body.chatId, body.tool as ScenarioToolName, body.args));
    }
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
        mutate(s => { s.currentChat.messages[messageId] = updated });
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
    mutate(s => { s.currentChat.messages[req.messageId] = updated });
    return { ok: true };
}

/**
 * Execute one command against the current chat: validate args, build + apply its
 * Block, persist the resulting ChatMessage, and return the effect text the agent
 * sees as the tool result. This is the single execution path shared by the agent
 * RPC handler (Claude subprocess) and the in-process AI SDK loop — both routes
 * call this so they cannot diverge on validation, state mutation, or persistence.
 */
export async function execCommand(
    chatId: string,
    command: CommandName,
    args: Record<string, unknown>,
    sdkUuid?: string,
) {
    const spec = COMMANDS[command];
    if (!spec) return { error: `unknown_command: ${command}` };

    const parsed = spec.schema.safeParse(args);
    if (!parsed.success) {
        return { error: `invalid_args: ${parsed.error.message}` };
    }

    if (state.currentChat.id !== chatId) {
        return { error: `chat_mismatch: agent is acting on ${chatId} but server's current chat is ${state.currentChat.id}` };
    }

    // Semantic validation against the live game state (e.g. use_item checking
    // inventory). Rejects before any Block is built or persisted. Same
    // any-cast rationale as toBlock below.
    if (spec.validate) {
        const invalid = (spec.validate as (a: unknown, c: GameStateContext) => string | null)(
            parsed.data,
            state.currentChat.gameState,
        );
        if (invalid) return { error: `invalid_action: ${invalid}` };
    }

    // Zod has already validated the args against this spec's schema; the
    // any-cast is needed because TS can't narrow toBlock's union signature
    // back to its origin spec when COMMANDS is iterated as a union map.
    const block = (spec.toBlock as (a: unknown) => ReturnType<typeof spec.toBlock>)(parsed.data);

    // Item icons are generated here rather than in toBlock (which must stay
    // pure and synchronous) — the resulting URL is baked into the block before
    // it is applied and persisted, so replay never re-generates. The turn
    // deliberately blocks on the job so the agent's next step sees a finished
    // item. The per-chat cache is the game state itself: a key that already
    // carries an icon reuses it instead of paying for another generation.
    // Resolve a library image's key to its URL. Same reason as the icon path:
    // toBlock is pure, and the chat's attached images aren't part of the game
    // state it's given.
    if (command === 'show_image') {
        const { key } = parsed.data as { key: string };
        const image = (state.currentChat.assets.images ?? [])
            .map((id) => state.assets.images[id])
            .find((i) => i?.key === key);
        if (!image) return { error: `unknown_image: no image with key "${key}" is attached to this chat. Call list_images for the available keys.` };
        (block as { src: string }).src = image.url;
    }

    // Same deal for generate_image, except the image IS the block: a failed
    // generation has nothing worth persisting, so it comes back to the agent as
    // a tool error instead of an <img> pointing at nothing.
    if (command === 'generate_image') {
        const args = parsed.data as { description: string; aspect: ImageAspect };
        const url = await generateSceneImage(args.description, args.aspect);
        if (!url) return { error: 'image_generation_failed: the image server did not return an image. Continue without it.' };
        (block as { src: string }).src = url;
    }

    // An icon this item already has is reused as-is. A new one is NOT awaited:
    // see the queueItemIcon call after the message is created.
    if (block.type === 'defineItem') {
        const existing = state.currentChat.gameState.itemDefs?.[block.key]?.icon;
        if (existing) block.icon = existing;
    }

    const effects: string[] = [];
    const ctxBefore = JSON.parse(JSON.stringify(state.currentChat.gameState));
    applyBlockToCtx(state.currentChat.gameState, block, effects);
    mutate(s => { s.currentChat.gameState = state.currentChat.gameState });

    const messageId = nanoid();
    const now = Date.now();
    const serialized = serializeBlocks([block]);

    const metadata: Record<string, unknown> = { agent: true };
    if (sdkUuid) metadata.sdkUuid = sdkUuid;

    const message = {
        id: messageId,
        role: 'assistant' as const,
        chatId,
        content: serialized,
        createdAt: now,
        updatedAt: now,
        metadata,
    };
    mutate(s => { s.currentChat.messages[messageId] = message });

    // Kicked off only once the block is persisted, because the icon patches
    // that message when it arrives. Not awaited: the model gets its tool result
    // now and keeps working while the GPU catches up.
    if (block.type === 'defineItem' && !block.icon && itemIconsEnabled()) {
        // The visual description is written for the image model; `description`
        // is the player-facing blurb and only stands in for items defined
        // before the field existed.
        const prompt = block.visualDescription ?? block.description ?? block.label;
        const key = block.key;
        queueItemIcon(block.label, prompt, key, (url) => attachItemIcon(chatId, messageId, key, url));
    }

    return {
        ok: true,
        messageId,
        effects: effects.length > 0 ? effects.join('\n') : describeNoOp(command, parsed.data, ctxBefore, state.currentChat.gameState),
    };
}

/**
 * Attach a generated icon to an already-persisted define_item block.
 *
 * The block is written before the picture exists, so this edits it after the
 * fact: re-parse, set `icon`, re-serialize. Going through the message (rather
 * than only patching gameState) is what makes it stick — game state is derived
 * by replaying blocks, so an icon that lived only in state would vanish on the
 * next replay.
 *
 * Silently does nothing when the message is gone or the chat has moved on. A
 * generation outlives rewinds, deletions and chat switches, and none of those
 * are errors — the user simply no longer wants what it was making.
 */
function attachItemIcon(chatId: string, messageId: string, key: string, url: string): void {
    if (state.currentChat.id !== chatId) return;
    const msg = state.currentChat.messages[messageId];
    if (!msg) return;

    const blocks = parseBlocks(msg.content);
    const target = blocks.find(b => b.type === 'defineItem' && b.key === key);
    if (!target || target.type !== 'defineItem') return;
    if (target.icon) return;

    // parseBlocks caches by content string and hands out shared arrays, so the
    // block must be replaced rather than mutated in place.
    const patched = blocks.map(b =>
        b === target ? { ...target, icon: url } : b);

    mutate(s => { s.currentChat.messages[messageId] = {
        ...msg,
        content: serializeBlocks(patched),
        updatedAt: Date.now(),
    } });

    // The live ctx was computed before the icon existed; replay would produce
    // it, but nothing replays until the next turn and the HUD is showing this
    // item now.
    const defs = state.currentChat.gameState.itemDefs;
    if (defs?.[key]) {
        mutate(s => { s.currentChat.gameState.itemDefs[key] = { ...defs[key]!, icon: url } });
    }
}

function handleExec(req: ExecRequest) {
    return execCommand(req.chatId, req.command, req.args, req.sdkUuid);
}

function describeNoOp(command: string, args: any, ctxBefore: any, ctxAfter: any): string {
    if (JSON.stringify(ctxBefore) === JSON.stringify(ctxAfter)) {
        return `${command} accepted (no state change). args: ${JSON.stringify(args)}`;
    }
    return `${command} accepted. args: ${JSON.stringify(args)}`;
}

/**
 * Run one read-only query against the current chat and return its textual
 * result. Shared by the agent RPC handler and the in-process AI SDK loop (same
 * rationale as execCommand).
 */
export function runQuery(chatId: string, query: QueryName, args: Record<string, unknown>) {
    const spec = QUERIES[query];
    if (!spec) return { error: `unknown_query: ${query}` };

    const parsed = spec.schema.safeParse(args);
    if (!parsed.success) {
        return { error: `invalid_args: ${parsed.error.message}` };
    }

    if (state.currentChat.id !== chatId) {
        return { error: `chat_mismatch: agent is querying ${chatId} but server's current chat is ${state.currentChat.id}` };
    }

    // Soft-deleted actors are withheld from the agent: it can still *see* them
    // in replayed history (blocks resolve independently), but it must not be
    // offered them as something to act on.
    const actors = visible(
        state.currentChat.assets.actors
            .map((id) => state.assets.actors[id])
            .filter((a): a is NonNullable<typeof a> => Boolean(a)),
    )
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
        }));

    const notes = visible(
        Object.entries(state.currentChat.assets.notes)
            .filter(([, ref]) => ref.enabled)
            .map(([id]) => state.assets.notes[id])
            .filter((n): n is NonNullable<typeof n> => Boolean(n)),
    )
        .map((n) => ({ title: n.title, type: n.type, content: n.content }));

    const images = (state.currentChat.assets.images ?? [])
        .map((id) => state.assets.images[id])
        .filter((i): i is NonNullable<typeof i> => Boolean(i))
        .map((i) => ({ key: i.key, label: i.label }));

    const deps = {
        ctx: state.currentChat.gameState,
        actors,
        notes,
        images,
    };

    // Cast around the same union-of-generic narrowing limitation as toBlock above.
    const result = (spec.run as (a: unknown, d: typeof deps) => string)(parsed.data, deps);
    return { ok: true, result };
}

function handleQuery(req: QueryRequest) {
    return runQuery(req.chatId, req.query, req.args);
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
            mutate(s => { s.currentChat.agentRehydration = null });
        }
        log.server.info(`Captured agent session ${req.sessionId} for chat ${req.chatId}`);
    }
    if (req.event === 'turn_ended') {
        mutate(s => { s.isGenerating = false });
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
 * out-of-band updates from the controller. The Anthropic API has no
 * system-role channel within the messages array, so by convention the
 * SDK ferries server-originated, non-user instruction-context inside a
 * user-role message tagged with a known XML wrapper. The system prompt
 * teaches the agent to treat <system_notice> content as authoritative
 * and out-of-character — distinct from the user's `<current_input>`,
 * and not to be narrated or acknowledged in output.
 *
 * Sections with empty body are dropped. If every section is empty,
 * callers should skip the wrap entirely.
 */
type SystemNoticeSection = { heading: string; body: string };

function wrapWithSystemNotice(sections: SystemNoticeSection[], userContent: string): string {
    const lines: string[] = ['<system_notice>'];
    const nonEmpty = sections.filter(s => s.body.trim() !== '');
    nonEmpty.forEach((s, i) => {
        if (i > 0) lines.push('');
        lines.push(s.heading);
        lines.push('');
        lines.push(s.body);
    });
    lines.push('</system_notice>', '', userContent);
    return lines.join('\n');
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

// In-flight in-process AI SDK turns, keyed by chatId, so `cancelAgentTurn` can
// abort them (the Claude path cancels via the subprocess instead).
const inFlightAiTurns = new Map<string, AbortController>();

/**
 * Run one OpenAI-v1 turn in-process. Unlike the Claude subprocess (which
 * announces `turn_ended` over RPC), this path clears its own bookkeeping:
 * persist the extended transcript and snapshot post-turn flags for the next
 * turn's `<system_notice>` delta. `isGenerating` is cleared by generateResponse's
 * finally. Aborts are swallowed (clean cancel); other errors propagate so the
 * caller can notify the user.
 */
async function runAiTurn(args: {
    chatId: string;
    systemPrompt: string;
    userContent: string;
    llmConfig: LLMConfig;
    transcript: ModelMessage[];
    enableChoicePrompts: boolean;
    enableSceneImages: boolean;
    enableItemIcons: boolean;
}) {
    const controller = new AbortController();
    inFlightAiTurns.set(args.chatId, controller);
    try {
        const { transcript } = await runAiSdkTurn({
            chatId: args.chatId,
            systemPrompt: args.systemPrompt,
            userContent: args.userContent,
            llmConfig: args.llmConfig,
            transcript: args.transcript,
            enableChoicePrompts: args.enableChoicePrompts,
            enableSceneImages: args.enableSceneImages,
            enableItemIcons: args.enableItemIcons,
            signal: controller.signal,
        });
        await saveAiTranscript(args.chatId, transcript);
        void writeFlagsSnapshot(args.chatId, state.currentChat.gameState.flags);
        // No session_captured event on this path (that's what clears the Claude
        // rehydration warning), so clear it here now that the transcript is
        // rebuilt — otherwise a post-invalidate AI-SDK turn leaves it stuck on.
        if (state.currentChat.id === args.chatId && state.currentChat.agentRehydration !== null) {
            mutate(s => { s.currentChat.agentRehydration = null });
        }
    } catch (err) {
        if (controller.signal.aborted) {
            log.server.info(`AI SDK turn aborted for chat ${args.chatId}`);
            return;
        }
        throw new Error(`AI SDK turn failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
        inFlightAiTurns.delete(args.chatId);
    }
}

export async function dispatchPromptToAgent(args: {
    chatId: string;
    userMessageId: string;
    userContent: string;
}) {
    const llmConfig = state.assets.llmConfigs[state.userPreferences.activeLLMConfigId!];
    if (!llmConfig) throw new Error('No model selected — choose one in Preferences first.');

    // Flag generation up front so the UI shows feedback immediately — before
    // the composer probe (up to ~1.5s) and macro expansion, and so a failure in
    // either still surfaces as a cleared spinner via generateResponse's finally
    // rather than no feedback at all.
    mutate(s => { s.isGenerating = true });

    // Re-run replay so any state effects from the just-appended user message
    // are visible to the agent's queries from the very first tool call.
    const turnResult = runTurn(Object.values(state.currentChat.messages));
    mutate(s => { s.currentChat.gameState = turnResult.ctx });
    setCurrentTurnResult(turnResult);

    let expandedSystemPrompt = '';
    let macroFeatures: Record<string, unknown> = {};
    try {
        const result = parseMacros(getDefaultSystemPrompt());
        expandedSystemPrompt = result.parsed;
        macroFeatures = result.features;
    } finally {
        setCurrentTurnResult(null);
    }

    // The choice-prompt instruction can be positioned by the user via its macro
    // (`@MULTICHOICE_PROMPT_INSTRUCTIONS()`); only when they haven't placed it do
    // we append it trailing, so toggling needs no prompt edits. The matching
    // end_turn `choices` arg is exposed agent-side under the same flag, keeping
    // instruction and capability in lockstep.
    const enableChoicePrompts = featureEnabled(state.userPreferences, 'choicePrompts');
    if (enableChoicePrompts && !macroFeatures['MULTICHOICE_PROMPT_INSTRUCTIONS']) {
        expandedSystemPrompt += `\n\n${MULTICHOICE_PROMPT_INSTRUCTIONS}`;
    }

    // Same lockstep for generate_image: the tool only exists when the sub-toggle
    // is on, so the agent is never told about a capability the exec path would
    // then refuse.
    const enableSceneImages = sceneImagesEnabled();
    // Same lockstep for define_item's visualDescription: it is only ever read
    // to prompt the icon image model, so with icons off the field is dropped
    // rather than asking for a paragraph nothing renders.
    const enableItemIcons = itemIconsEnabled();

    // Provider → loop. Anthropic uses the Claude Agent SDK subprocess; OpenAI-v1
    // (openai/custom) uses the in-process AI SDK loop. Each keeps private memory
    // (Claude session id vs ai_transcript), both rebuildable from the canonical
    // ChatMessage log — so a provider switch just rehydrates the active loop.
    const currentLoop: 'claude' | 'ai-sdk' =
        llmConfig.provider === 'anthropic' ? 'claude'
            : (llmConfig.provider === 'openai' || llmConfig.provider === 'custom') ? 'ai-sdk'
                : (() => { throw new Error(`Provider "${llmConfig.provider}" isn't supported yet — use an Anthropic model or an OpenAI-v1-compatible (openai/custom) endpoint.`); })();

    // The Claude loop can't start without a signed-in CLI, and left alone it
    // reports the wrong problem: `dependencyPath` yields null for an
    // unauthenticated CLI exactly as it does for an absent one, so the SDK
    // fails with "Native CLI binary not found" and sends the user looking for a
    // missing file. Check the real condition and carry the fix with the error.
    // Costs nothing extra — dependencyPath() below runs the same check, and
    // checkClaudeAuth caches for 10s.
    if (currentLoop === 'claude') {
        const claudeStatus = await verifyDependency('claudeCli').catch(() => 'missing' as const);
        if (claudeStatus !== 'satisfied') {
            throw new ActionableError(
                claudeStatus === 'unauthenticated'
                    ? 'No Claude account is connected, so this model can\'t run.'
                    : `${DEPENDENCIES.claudeCli.label} isn't ready — Anthropic models run through it.`,
                { label: 'Fix this', kind: 'openLlmConfig' },
            );
        }
    }

    const chatRow = await db.selectFrom('chats')
        .select(['agent_session_id', 'last_agent_loop', 'last_agent_flags_snapshot'])
        .where('id', '=', args.chatId)
        .executeTakeFirst();

    // On a provider switch the now-active loop's private memory is stale, so it
    // rehydrates from the ChatMessage log (shared truth) rather than resuming.
    const providerSwitched = (chatRow?.last_agent_loop ?? null) !== null
        && chatRow!.last_agent_loop !== currentLoop;

    // Claude resumes its SDK session; the AI SDK loop resumes its transcript —
    // unless switched/absent, in which case both fall back to rehydration.
    const resumeSessionId = currentLoop === 'claude' && !providerSwitched
        ? (chatRow?.agent_session_id ?? null)
        : null;
    const transcript: ModelMessage[] = currentLoop === 'ai-sdk' && !providerSwitched
        ? await loadAiTranscript(args.chatId)
        : [];
    const needsPreamble = currentLoop === 'claude' ? resumeSessionId === null : transcript.length === 0;

    // No live memory for the active loop — first turn, provider switch, or a
    // branched/cloned/orphaned chat — so synthesize a context preamble from the
    // persisted ChatMessages and prepend it. At most once per (re-)orphaning;
    // subsequent turns resume the loop's own memory.
    let userContent = needsPreamble
        ? wrapWithHistoryPreamble(
            Object.values(state.currentChat.messages),
            args.userMessageId,
            args.userContent,
        )
        : args.userContent;

    // <system_notice>: out-of-band flag deltas + a one-shot director's note.
    // Provider-agnostic — both loops receive the same wrapped userContent. The
    // convention (an XML tag the model treats as distinct from user dialogue) is
    // taught by RP_PROMPT.md; works for any model, not just Anthropic.
    const flagsSnapshot = chatRow?.last_agent_flags_snapshot
        ? JSON.parse(chatRow.last_agent_flags_snapshot) as Record<string, unknown>
        : null;
    const flagsDelta = buildFlagsDelta(flagsSnapshot, state.currentChat.gameState.flags);

    // One-shot director's note composed in the UI. Consumed and cleared
    // here so it attaches to exactly one turn.
    const directorNote = state.currentChat.pendingSystemNotice.trim();
    if (directorNote) mutate(s => { s.currentChat.pendingSystemNotice = '' });

    const sections: SystemNoticeSection[] = [];
    if (flagsDelta) {
        sections.push({
            heading: 'State changes occurred outside the agent loop since the previous turn. Treat these as ground truth:',
            body: flagsDelta,
        });
    }
    if (directorNote) {
        sections.push({
            heading: 'Out-of-character note from the controller — not user dialogue. Do not narrate, acknowledge, or repeat any of this content. Adjust behavior silently:',
            body: directorNote,
        });
    }
    if (sections.length > 0) {
        userContent = wrapWithSystemNotice(sections, userContent);
    }

    // Debug snapshot of the exact payload about to be dispatched. Gated on the
    // debug pref so nothing is captured/synced when off. In-memory only (never
    // persisted). AI-SDK sends the full transcript + this user turn; Claude sends
    // only this user turn (prior turns live in its resumed session, unless we
    // rehydrated from the log, in which case the full history is inside userContent).
    if (state.userPreferences.debug) {
        const messages = currentLoop === 'ai-sdk'
            ? [...transcript.map(normalizeModelMessage), { role: 'user', content: userContent }]
            : [{ role: 'user', content: userContent }];
        mutate(s => { s.currentChat.lastPrompt = {
            capturedAt: Date.now(),
            provider: llmConfig.provider,
            model: llmConfig.model,
            loop: currentLoop,
            systemPrompt: expandedSystemPrompt,
            messages,
            rehydratedFromLog: needsPreamble,
            resumedSessionId: resumeSessionId,
        } });
    }

    if (currentLoop === 'claude') {
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
                    enableChoicePrompts,
                    enableSceneImages,
                    enableItemIcons,
                    // Resolved per turn rather than read from the environment
                    // the agent was spawned with. A CLI downloaded (or
                    // installed) after startup would otherwise never reach a
                    // long-running agent, and the SDK fails with "Native CLI
                    // binary not found" instead of using it.
                    claudeCliPath: await dependencyPath('claudeCli'),
                }),
            });
        } catch (err) {
            // Network-level failure: subprocess unreachable, crashed, restarted
            // mid-request. generateResponse's finally clears isGenerating.
            throw new Error(`Agent unreachable: ${err instanceof Error ? err.message : String(err)}`);
        }

        if (!response.ok) {
            // The subprocess always returns 200 with a structured body, so a
            // non-OK status is something it couldn't catch — defensive only.
            const errText = await response.text().catch(() => '');
            throw new Error(`Agent transport error ${response.status}: ${errText.slice(0, 200)}`);
        }

        // ok=false means an internal agent failure (SDK Overloaded, transport
        // closed, etc.) the subprocess caught cleanly — surface it as a throw so
        // generateResponse's catch notifies the user.
        const result = await response.json().catch(() => ({ ok: false, error: 'invalid agent response body' })) as
            | { ok: true; sessionId: string | null; aborted?: boolean }
            | { ok: false; sessionId: string | null; error: string; errorName?: string };
        if (!result.ok) {
            throw new Error(`Agent reported failure${result.errorName ? ` (${result.errorName})` : ''}: ${result.error}`);
        }
        log.server.info(`Agent turn complete for chat ${args.chatId}: ${JSON.stringify(result).slice(0, 200)}`);
    } else {
        await runAiTurn({
            chatId: args.chatId,
            systemPrompt: expandedSystemPrompt,
            userContent,
            llmConfig,
            transcript,
            enableChoicePrompts,
            enableSceneImages,
            enableItemIcons,
        });
        log.server.info(`AI SDK turn complete for chat ${args.chatId}`);
    }

    // Record which loop owns this chat's live memory, so a later provider switch
    // rehydrates the other loop from the message log.
    await db.updateTable('chats').set({ last_agent_loop: currentLoop }).where('id', '=', args.chatId).execute();
}

export async function cancelAgentTurn() {
    // In-process AI SDK turns abort directly via their AbortController.
    let abortedAi = false;
    for (const ctrl of inFlightAiTurns.values()) {
        ctrl.abort();
        abortedAi = true;
    }
    if (abortedAi) return;

    // Otherwise it's a Claude subprocess turn — cancel over RPC.
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
        .set({ agent_session_id: null, ai_transcript: null })
        .where('id', '=', chatId)
        .execute();
    if (state.currentChat.id === chatId) {
        const msgs = Object.values(state.currentChat.messages);
        if (msgs.length > 0) {
            const chars = msgs.reduce((sum, m) => sum + m.content.length, 0);
            mutate(s => { s.currentChat.agentRehydration = {
                messageCount: msgs.length,
                estimatedTokens: Math.ceil(chars / 4),
            } });
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
        // No Claude session — but this chat may be on the AI SDK loop, whose
        // memory is `ai_transcript`. A structural edit (regen/rewind) just
        // changed the message log, so clear the transcript too; the next AI-SDK
        // turn rehydrates from the edited log instead of resuming stale memory.
        await db.updateTable('chats').set({ ai_transcript: null }).where('id', '=', args.chatId).execute();
        log.server.info(`No agent session to fork for chat ${args.chatId}; cleared ai_transcript; first prompt will rehydrate`);
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
        .set({ agent_session_id: newSessionId, ai_transcript: null })
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
        .set({ agent_session_id: newSessionId, ai_transcript: null })
        .where('id', '=', args.targetChatId)
        .execute();
    log.server.info(`Forked session ${sourceSessionId} -> ${newSessionId} for ${args.sourceChatId} -> ${args.targetChatId}${anchor ? ` @ ${anchor.slice(0, 8)}…` : ' (full copy)'}`);
    return newSessionId;
}
