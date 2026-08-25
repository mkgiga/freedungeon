import config from '../config.json' with { type: "json" };
import { createStore, produce, unwrap } from "solid-js/store";
import { produceWithPatches, enablePatches, setAutoFreeze } from "immer";
import { isPrivateIP } from './utils/net';
import { Hono } from "hono";
import { cors } from "hono/cors";
import { getConnInfo, serveStatic } from "hono/bun";
import { log, startupBanner } from './logger';
import { DATA_DIR } from './paths';
import pkg from '../package.json' with { type: 'json' };
import { initDb, persistPath, loadStateFromDb, db } from './db';
import { seedExampleContent } from './seed';
import { initSdBuildChoice } from './sd/dependency';
import { sql } from 'kysely';
import './macro.ts';
import { loadPreferences } from './preferences';
import { Server, Socket } from "socket.io";
import { createServer } from 'node:http';
import { trpcServer } from '@hono/trpc-server';
import { appRouter } from './v2/router';
import { uploadsRouter } from './v2/uploads';
import type { AppState, CurrentChatState } from '@shared/types';
import { z } from 'zod';
import { nanoid } from 'nanoid';
import { createInitialContext } from './game-state';
import { agentRpcRouter, spawnAgentProcess, killAgentProcess } from './agent';
import { stopSdServer } from './sd/server';
import { getEmbeddedClientFiles } from './embedded';
import { refreshDependencies } from './dependencies';
import { applyDeleteCascades } from './cascade';
import { extensionUploadRouter } from './v2/extensions/upload';
import { loadExtensions } from './extensions/host';
import { FEATURES, resolveFeatureState, type FeatureKey } from '@shared/features';
import { ensureCert } from './tls';
import { createServer as createHttpsServer } from 'node:https';

export const app = new Hono();
export const httpServer = createServer();
export const io = new Server(httpServer, {
    cors: {
        origin: '*',
    }
});

export const [state, _setState] = createStore({
    assets: {
        actors: {},
        notes: {},
        images: {},
        llmConfigs: {},
        chats: {},
    },
    currentChat: {
        id: null,
        title: "",
        assets: {
            actors: [],
            notes: {},
            images: [],
        },
        messages: {},
        gameState: createInitialContext(),
        agentRehydration: null,
        pendingSystemNotice: '',
        createdAt: null,
        updatedAt: null,
    } as CurrentChatState,
    isGenerating: false,
    activities: {},
    dependencies: {},
    notifications: {},
    extensionState: {},
    extensions: {},
    userPreferences: {
        theme: "system",
        playerCharacterId: null,
        activeLLMConfigId: null,
        enableChoicePrompts: false,
        debug: false,
        features: {},
    }
} as AppState);

enablePatches();
setAutoFreeze(false);

/**
 * Edit application state by mutating a draft:
 *
 *     mutate(d => { d.currentChat.gameState.itemDefs[key].icon = url })
 *
 * Immer records which leaves changed and returns patches `persistPath` and the
 * socket already speak, so several edits in one call become several precise
 * patches rather than one whole-object write. A draft creates intermediates as
 * you assign, so `d.a.b = { c: 1 }` works whether or not `a.b` existed.
 */
export function mutate(fn: (draft: AppState) => void): void {
    const [, patches] = produceWithPatches(unwrap(state) as AppState, fn as (d: AppState) => void);
    for (const patch of patches) {
        const path = patch.path as (string | number)[];
        if (patch.op === 'remove') {
            removeAt(path);
        } else {
            applyValue(path, patch.value);
            persistPath(path);
            io.emit('state', { path, value: patch.value });
        }
    }
}

function applyValue(path: (string | number)[], value: unknown): void {
    if (value === null || typeof value !== 'object') {
        (_setState as Function)(...path, value);
        return;
    }
    _setState(produce((s: any) => {
        let target = s;
        for (const p of path.slice(0, -1)) target = target[p];
        target[path.at(-1)!] = value;
    }));
}

function removeAt(path: (string | number)[]): void {
    const parentPath = path.slice(0, -1);
    const key = path.at(-1)!;
    applyDeleteCascades(path.map(String), state, {
        set: (root, id, value) => setState('assets', root, id, value),
        remove: (root, id) => deleteState('assets', root, id),
    });
    _setState(produce((s: any) => {
        let target = s;
        for (const p of parentPath) target = target[p];
        delete target[key];
    }));
    persistPath(path);
    io.emit('delete', { path: parentPath, key });
}

/**
 * The low-level path write. `mutate` is the API for application code; this is
 * for dynamic paths (the cascade callbacks below) and the boot writes, where
 * setStore's MERGE is load-bearing - `setState('userPreferences', loaded)`
 * keeps keys the initial store declares that a stored file predates, which an
 * assignment would drop.
 */
export function setState(...args: any[]) {
    (_setState as Function)(...args);
    const path = args.slice(0, -1);
    persistPath(path);
    io.emit('state', { path, value: readPath(path) });
}

function readPath(path: unknown[]): unknown {
    let node: any = state;
    for (const part of path) {
        if (node == null) return undefined;
        node = node[part as keyof typeof node];
    }
    return node;
}

export function deleteState(...path: string[]) {
    applyDeleteCascades(path, state, {
        set: (root, id, value) => setState('assets', root, id, value),
        remove: (root, id) => deleteState('assets', root, id),
    });

    const key = path.at(-1)!;
    const parentPath = path.slice(0, -1);
    _setState(produce((s: any) => {
        let target = s;
        for (const p of parentPath) target = target[p];
        delete target[key];
    }));
    persistPath(path);
    io.emit('delete', { path: parentPath, key });
}

function seedExtensionState(stored: Record<string, Record<string, unknown>>) {
    const keys = new Set([...Object.keys(FEATURES), ...Object.keys(stored ?? {})]);
    for (const key of keys) {
        const declared = FEATURES[key]?.state
        const values = declared
            ? resolveFeatureState(key as FeatureKey, stored?.[key])
            : (stored?.[key] ?? {})
        setState('extensionState', key, values);
    }
}

function start() {
    (async () => {
        await initDb();
        const loaded = await loadStateFromDb();
        setState('assets', loaded.assets);
        setState('userPreferences', loadPreferences());
        seedExtensionState(loaded.extensionState);
        await logChatMessageCounts();
        backfillOnboarding();
        await initSdBuildChoice();
        seedExampleContent();
        await refreshDependencies();
        await loadExtensions();
        await initProcessHandlers();
        await initHttp();
        await initWebSocket();
        await listen();
        spawnAgentProcess();
    })();
}

function backfillOnboarding() {
    if (state.userPreferences.onboardingCompletedAt) return;

    const hasHistory = Object.keys(state.assets.chats).length > 0
        || Object.keys(state.assets.llmConfigs).length > 0;
    if (!hasHistory) return;

    log.server.info('Existing install detected; skipping first-run onboarding.');
    setState('userPreferences', 'onboardingCompletedAt', Date.now());
}

async function logChatMessageCounts() {
    const rows = await db.selectFrom('chat_messages')
        .select(['chat_id', db.fn.count<number>('id').as('count')])
        .groupBy('chat_id')
        .execute();
    if (rows.length === 0) {
        console.log('[STARTUP] chat_messages table is empty.');
        return;
    }
    console.log(`[STARTUP] chat_messages counts per chat:`);
    for (const row of rows) {
        console.log(`[STARTUP]   ${row.chat_id}: ${row.count}`);
    }
}

async function checkpointWal() {
    try {
        await sql`PRAGMA wal_checkpoint(TRUNCATE)`.execute(db);
    } catch (err) {
        log.server.error(`WAL checkpoint failed: ${err}`);
    }
}

function exitWithPortError(err: unknown, port: number, wsPort: number): never {
    const message = err instanceof Error ? err.message : String(err);
    log.server.error(`Could not start: ${message}`);
    console.error(
        `\nfreedungeon needs ports ${port} and ${wsPort}, and one of them is already in use.\n` +
        `Most likely another copy of freedungeon is already running — check for it before starting a new one.\n` +
        `Otherwise pick different ports:\n\n` +
        `    freedungeon --port ${port + 10} --ws-port ${wsPort + 10}\n`,
    );
    process.exit(1);
}

async function listen() {
    app.route('/uploads', uploadsRouter);
    app.route('/extensions', extensionUploadRouter);
    app.route('/agent-rpc', agentRpcRouter);
    app.use('/trpc/*', trpcServer({ router: appRouter }));

    const embeddedClient = getEmbeddedClientFiles();
    if (embeddedClient) {
        app.get('*', async (c) => {
            const requested = decodeURIComponent(new URL(c.req.url).pathname).replace(/^\/+/, '');
            const key = embeddedClient.has(requested) ? requested : 'index.html';
            const bytes = embeddedClient.get(key);
            if (!bytes) return c.text('Not found', 404);
            return new Response(bytes, { headers: { 'content-type': Bun.file(key).type } });
        });
    } else {
        app.use('/*', serveStatic({ root: './client/dist' }));
        app.get('*', serveStatic({ path: './client/dist/index.html' }));
    }

    const port = Number(process.env.FREEDUNGEON_PORT) || config.server.port || 8078;
    const wsPort = Number(process.env.FREEDUNGEON_WS_PORT) || config.server.wsPort || 8079;
    const hostname = process.env.FREEDUNGEON_HOST || config.server.hostname || "0.0.0.0";
    const httpsEnabled = process.env.FREEDUNGEON_HTTPS === '1' || (config.server as { https?: boolean }).https === true;
    const httpsPort = Number(process.env.FREEDUNGEON_HTTPS_PORT) || (config.server as { httpsPort?: number }).httpsPort || 8443;

    try {
        Bun.serve({ port, hostname, fetch: app.fetch });
        httpServer.listen(wsPort);
    } catch (err) {
        exitWithPortError(err, port, wsPort);
    }

    if (httpsEnabled) {
        await startHttpsListener(hostname, httpsPort);
    }
    httpServer.on('error', (err) => exitWithPortError(err, port, wsPort));

    startupBanner({
        version: pkg.version,
        host: hostname,
        port,
        agentPort: Number(process.env.AGENT_PORT ?? 8076),
        dataDir: DATA_DIR,
    });
}

async function startHttpsListener(hostname: string, httpsPort: number): Promise<void> {
    const tls = await ensureCert();
    if (!tls) return;

    const wssPort = httpsPort + 1;
    try {
        Bun.serve({ port: httpsPort, hostname, tls: { cert: tls.cert, key: tls.key }, fetch: app.fetch });
        const wssServer = createHttpsServer({ cert: tls.cert, key: tls.key });
        io.attach(wssServer);
        wssServer.on('error', (err) => log.server.warn(`HTTPS: socket listener failed (${err.message})`));
        wssServer.listen(wssPort);
        log.server.ok(`HTTPS: https://${tls.host}:${httpsPort}  (installable on phones; key is public — see tls.ts)`);
    } catch (err) {
        log.server.warn(`HTTPS: could not listen on ${httpsPort} (${err instanceof Error ? err.message : err}); HTTP is unaffected`);
    }
}

async function initHttp() {
    app.use('*', cors({ origin: '*' }));
    app.use('*', async (c, next) => {
        const info = getConnInfo(c);
        const clientIp = info.remote.address;
        if (clientIp && isPrivateIP(clientIp)) {
            return next();
        }
        return c.text('Who are you?', 403);
    });
}

const activeSockets = new Set<Socket>();
async function initWebSocket() {
    io.use((socket, next) => {
        const clientIp = socket.handshake.address;
        if (clientIp && isPrivateIP(clientIp)) {
            return next();
        }
        log.server.info(`Rejected non-local WebSocket connection from ${clientIp || 'unknown'}`);
        return next(new Error('Who are you?'));
    });

    io.on('connection', (socket) => {
        log.server.info(`New WebSocket connection: ${socket.id}`);
        activeSockets.add(socket);
        socket.emit('init', JSON.parse(JSON.stringify(state)));

        socket.on('disconnect', () => {
            log.server.info(`WebSocket disconnected: ${socket.id}`);
            activeSockets.delete(socket);
        });
    });
}

async function initProcessHandlers() {
    let shuttingDown = false

    process.on('unhandledRejection', (reason) => {
        const msg = reason instanceof Error ? `${reason.name}: ${reason.message}` : String(reason);
        log.server.error(`Unhandled promise rejection: ${msg}`);
    });
    process.on('uncaughtException', (err) => {
        log.server.error(`Uncaught exception: ${err.name}: ${err.message}`);
    });

    const gracefulShutdown = (signal: string) => {
        if (shuttingDown) return;
        shuttingDown = true;

        console.log(`Received ${signal}, shutting down...`)

        for (const socket of activeSockets) {
            socket.disconnect(true)
        }

        checkpointWal()
        killAgentProcess()
        stopSdServer()
        console.log('Exiting now.')
        process.exit(0)
    }
    process.prependOnceListener('SIGINT', gracefulShutdown);
    process.prependOnceListener('SIGTERM', gracefulShutdown);

}

start();