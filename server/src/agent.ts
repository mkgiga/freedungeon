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
import { runAiSdkTurn, loadAiTranscript, saveAiTranscript } from './ai-agent';

const AGENT_PORT = Number(process.env.AGENT_PORT ?? 8076);
const AGENT_URL = `http://127.0.0.1:${AGENT_PORT}`;

let agentProcess: ChildProcess | null = null;

/**
 * Spawn the agent as a child of the server, so it dies with the server and is
 * restarted on crash-loop. It listens on AGENT_PORT and is called over HTTP.
 */
export async function spawnAgentProcess() {
    if (agentProcess) return;

    const [command, args, cwd] = isEmbedded()
        ? [process.execPath, ['--agent'], undefined]
        : ['bun', ['run', 'index.ts'], path.join(import.meta.dirname, '..', '..', 'integrations', 'agent-claude')];

    const claudeCli = await dependencyPath('claudeCli');

    log.server.info(`Spawning agent process${cwd ? ` from ${cwd}` : ''} on port ${AGENT_PORT}...`);
    const proc = spawn(command, args, {
        cwd,
        env: {
            ...process.env,
            AGENT_PORT: String(AGENT_PORT),
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

    if (spec.validate) {
        const invalid = (spec.validate as (a: unknown, c: GameStateContext) => string | null)(
            parsed.data,
            state.currentChat.gameState,
        );
        if (invalid) return { error: `invalid_action: ${invalid}` };
    }

    const block = (spec.toBlock as (a: unknown) => ReturnType<typeof spec.toBlock>)(parsed.data);

    if (command === 'show_image') {
        const { key } = parsed.data as { key: string };
        const image = (state.currentChat.assets.images ?? [])
            .map((id) => state.assets.images[id])
            .find((i) => i?.key === key);
        if (!image) return { error: `unknown_image: no image with key "${key}" is attached to this chat. Call list_images for the available keys.` };
        (block as { src: string }).src = image.url;
    }

    if (command === 'generate_image') {
        const args = parsed.data as { description: string; aspect: ImageAspect };
        const url = await generateSceneImage(args.description, args.aspect);
        if (!url) return { error: 'image_generation_failed: the image server did not return an image. Continue without it.' };
        (block as { src: string }).src = url;
    }

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

    if (block.type === 'defineItem' && !block.icon && itemIconsEnabled()) {
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

function attachItemIcon(chatId: string, messageId: string, key: string, url: string): void {
    if (state.currentChat.id !== chatId) return;
    const msg = state.currentChat.messages[messageId];
    if (!msg) return;

    const blocks = parseBlocks(msg.content);
    const target = blocks.find(b => b.type === 'defineItem' && b.key === key);
    if (!target || target.type !== 'defineItem') return;
    if (target.icon) return;

    const patched = blocks.map(b =>
        b === target ? { ...target, icon: url } : b);

    mutate(s => { s.currentChat.messages[messageId] = {
        ...msg,
        content: serializeBlocks(patched),
        updatedAt: Date.now(),
    } });

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

    const actors = visible(
        state.currentChat.assets.actors
            .map((id) => state.assets.actors[id])
            .filter((a): a is NonNullable<typeof a> => Boolean(a)),
    )
        .map((a) => ({
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
        if (state.currentChat.id === req.chatId && state.currentChat.agentRehydration !== null) {
            mutate(s => { s.currentChat.agentRehydration = null });
        }
        log.server.info(`Captured agent session ${req.sessionId} for chat ${req.chatId}`);
    }
    if (req.event === 'turn_ended') {
        mutate(s => { s.isGenerating = false });
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

function buildFlagsDelta(
    snapshot: Record<string, unknown> | null,
    current: Record<string, unknown>,
): string {
    if (snapshot === null) return '';
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

const inFlightAiTurns = new Map<string, AbortController>();

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

    mutate(s => { s.isGenerating = true });

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

    const enableChoicePrompts = featureEnabled(state.userPreferences, 'choicePrompts');
    if (enableChoicePrompts && !macroFeatures['MULTICHOICE_PROMPT_INSTRUCTIONS']) {
        expandedSystemPrompt += `\n\n${MULTICHOICE_PROMPT_INSTRUCTIONS}`;
    }

    const enableSceneImages = sceneImagesEnabled();
    const enableItemIcons = itemIconsEnabled();

    const currentLoop: 'claude' | 'ai-sdk' =
        llmConfig.provider === 'anthropic' ? 'claude'
            : (llmConfig.provider === 'openai' || llmConfig.provider === 'custom') ? 'ai-sdk'
                : (() => { throw new Error(`Provider "${llmConfig.provider}" isn't supported yet — use an Anthropic model or an OpenAI-v1-compatible (openai/custom) endpoint.`); })();

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

    const providerSwitched = (chatRow?.last_agent_loop ?? null) !== null
        && chatRow!.last_agent_loop !== currentLoop;

    const resumeSessionId = currentLoop === 'claude' && !providerSwitched
        ? (chatRow?.agent_session_id ?? null)
        : null;
    const transcript: ModelMessage[] = currentLoop === 'ai-sdk' && !providerSwitched
        ? await loadAiTranscript(args.chatId)
        : [];
    const needsPreamble = currentLoop === 'claude' ? resumeSessionId === null : transcript.length === 0;

    let userContent = needsPreamble
        ? wrapWithHistoryPreamble(
            Object.values(state.currentChat.messages),
            args.userMessageId,
            args.userContent,
        )
        : args.userContent;

    const flagsSnapshot = chatRow?.last_agent_flags_snapshot
        ? JSON.parse(chatRow.last_agent_flags_snapshot) as Record<string, unknown>
        : null;
    const flagsDelta = buildFlagsDelta(flagsSnapshot, state.currentChat.gameState.flags);

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
                    claudeCliPath: await dependencyPath('claudeCli'),
                }),
            });
        } catch (err) {
            throw new Error(`Agent unreachable: ${err instanceof Error ? err.message : String(err)}`);
        }

        if (!response.ok) {
            const errText = await response.text().catch(() => '');
            throw new Error(`Agent transport error ${response.status}: ${errText.slice(0, 200)}`);
        }

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

    await db.updateTable('chats').set({ last_agent_loop: currentLoop }).where('id', '=', args.chatId).execute();
}

export async function cancelAgentTurn() {
    let abortedAi = false;
    for (const ctrl of inFlightAiTurns.values()) {
        ctrl.abort();
        abortedAi = true;
    }
    if (abortedAi) return;

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
 * Drop a chat's SDK session and arm rehydration: the next prompt injects the
 * full message history as a preamble into a fresh session.
 *
 * The fork-failure / no-anchor fallback. If the chat is the loaded one and has
 * messages, sets the rehydration flag so the next send warns and confirms cost.
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
 * Fork the SDK session at a clean turn boundary at or before
 * `keepUntilMessageId`, persisting the new id to `chat.agent_session_id`.
 *
 * Any failure INVALIDATES the session so the next prompt rehydrates from the
 * displayed chat - a diverged transcript makes characters ignore events the
 * user can see. No source session at all is a no-op.
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
 * Fork the source chat's SDK session onto `targetChatId`, so branch / clone /
 * saveAsTemplate inherit the agent's memory.
 *
 * `fullCopy` takes the whole session. `untilMessage` forks at the turn-closer
 * anchor at or before `keepUntilMessageId`, resolved against `sourceMessages`
 * (which must still hold the pre-clone ids).
 *
 * Null on no session, no anchor, or a failed fork - the derived chat then
 * starts fresh.
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
