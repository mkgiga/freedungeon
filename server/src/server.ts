import config from '../config.json' with { type: "json" };
import { createStore, produce } from "solid-js/store";
import { isPrivateIP } from './utils/net';
import { Hono } from "hono";
import { cors } from "hono/cors";
import { getConnInfo, serveStatic } from "hono/bun";
import { log, startupBanner } from './logger';
import { DATA_DIR } from './paths';
import pkg from '../package.json' with { type: 'json' };
import { initDb, persistPath, loadStateFromDb, db } from './db';
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
import { notification } from './notifications';
import { nanoid } from 'nanoid';
import { createInitialContext } from './game-state';
import { agentRpcRouter, spawnAgentProcess, killAgentProcess } from './agent';
import { getEmbeddedClientFiles } from './embedded';
import { refreshDependencies } from './dependencies';
import { applyDeleteCascades } from './cascade';

export const app = new Hono();
export const httpServer = createServer();
export const io = new Server(httpServer, {
    cors: {
        origin: '*',
    }
});

/**
 * Single source of truth for the entire app.
 */
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
    notifications: [],
    userPreferences: {
        theme: "system",
        playerCharacterId: null,
        activeLLMConfigId: null,
        enableChoicePrompts: false,
        debug: false,
        features: {},
    }
} as AppState);


export function setState(...args: any[]) {
    (_setState as Function)(...args);
    const value = args.at(-1);
    const path = args.slice(0, -1);
    persistPath(path);
    io.emit('state', { path, value });
}

export function deleteState(...path: string[]) {
    // Foreign keys handle this on disk, but the store is what everything reads
    // — see cascade.ts. Runs first so a rule can still inspect the entity.
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

function start() {
    (async () => {
        await initDb();
        const loaded = await loadStateFromDb();
        setState('assets', loaded.assets);
        setState('userPreferences', loadPreferences());
        await logChatMessageCounts();
        backfillOnboarding();
        await refreshDependencies();
        await initProcessHandlers();
        await initHttp();
        await initWebSocket();
        await listen();
        spawnAgentProcess();
    })();
}

/**
 * Mark pre-existing installs as already onboarded, once.
 *
 * Without this, everyone who was using freedungeon before onboarding existed
 * gets the first-run overlay on their next launch. "Has a chat or an LLM
 * config" is a safe read of "has clearly used this app" — and it's safe
 * precisely because it runs only when the stamp is absent. From then on the
 * stamp is authoritative, so later deleting every config doesn't re-trigger
 * anything.
 */
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

/** Report a port collision in terms the user can act on, then stop. */
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
    app.route('/agent-rpc', agentRpcRouter);
    app.use('/trpc/*', trpcServer({ router: appRouter }));

    // Serve the built client. Requests that match a real file (/, /assets/...,
    // /favicon.svg, ...) resolve to that file; anything else falls through to
    // index.html so client-side routing works.
    //
    // A compiled binary has no client/dist on disk — the bundle was embedded at
    // build time, so serve it out of the virtual filesystem instead.
    const embeddedClient = getEmbeddedClientFiles();
    if (embeddedClient) {
        app.get('*', async (c) => {
            const requested = decodeURIComponent(new URL(c.req.url).pathname).replace(/^\/+/, '');
            const key = embeddedClient.has(requested) ? requested : 'index.html';
            const bytes = embeddedClient.get(key);
            if (!bytes) return c.text('Not found', 404);
            // Serving bytes rather than a file loses the Content-Type that
            // Bun.file() infers from disk, and a stylesheet sent as
            // application/octet-stream is simply ignored by the browser.
            // Bun.file() derives the type from the path alone, without the
            // file needing to exist.
            return new Response(bytes, { headers: { 'content-type': Bun.file(key).type } });
        });
    } else {
        app.use('/*', serveStatic({ root: './client/dist' }));
        app.get('*', serveStatic({ path: './client/dist/index.html' }));
    }

    // Launch flags beat config.json, which beats the built-in defaults. The
    // env vars are set by the pre-init pass in main.ts.
    const port = Number(process.env.FREEDUNGEON_PORT) || config.server.port || 8078;
    const wsPort = Number(process.env.FREEDUNGEON_WS_PORT) || config.server.wsPort || 8079;
    const hostname = process.env.FREEDUNGEON_HOST || config.server.hostname || "0.0.0.0";

    // Bind failures are the single most likely startup error — a second copy of
    // the app, or something else on the port. Left unhandled it surfaces as an
    // unhandled rejection, the event loop empties, and `beforeExit` runs the
    // shutdown path, so the user sees "Graceful shutdown initiated by 0" and no
    // mention of a port. Catch it and say what actually happened.
    try {
        Bun.serve({ port, hostname, fetch: app.fetch });
        httpServer.listen(wsPort);
    } catch (err) {
        exitWithPortError(err, port, wsPort);
    }
    // node's http server reports bind failures asynchronously, not by throwing.
    httpServer.on('error', (err) => exitWithPortError(err, port, wsPort));

    startupBanner({
        version: pkg.version,
        host: hostname,
        port,
        agentPort: Number(process.env.AGENT_PORT ?? 8076),
        dataDir: DATA_DIR,
    });
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
    // Mirror the HTTP gate (initHttp) on the WebSocket port: only private-range
    // peers may connect. On 'init' we emit the full state — including LLM
    // config API keys — so an unauthenticated public connection would leak
    // secrets. socket.io's cors.origin only restrains browsers; this rejects
    // any non-browser client too. isPrivateIP handles IPv6 loopback and
    // IPv4-mapped peers itself.
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
        setTimeout(() => {
            notification({
                title: 'Welcome to RPApp!',
                content: 'Test',
                backgroundColor: '#333',
                textColor: '#fff',
                show: true,
                push: false,
            });
        }, 1000);

        socket.on('disconnect', () => {
            log.server.info(`WebSocket disconnected: ${socket.id}`);
            activeSockets.delete(socket);
        });
    });
}

async function initProcessHandlers() {
    let shuttingDown = false

    // Safety net. Bun's default behavior for an unhandled promise
    // rejection is to exit with code 1. The agent flow has multiple
    // long-running async chains (fetch into the agent subprocess,
    // SDK stream iteration, tRPC mutations that fire-and-forget the
    // turn) and any one of them can produce an unhandled rejection
    // when the SDK errors (Overloaded), the subprocess transport
    // closes, or a fork call fails. Without these handlers a single
    // Anthropic 529 takes the whole server down. With them, we log
    // and keep serving — the failing turn surfaces to the client via
    // the notification channel.
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

        // Nothing to flush — every mutation persists at write time via
        // persistPath. Just fold the WAL back into the main db file.
        checkpointWal()
        killAgentProcess()
        console.log('Exiting now.')
        process.exit(0)
    }
    // Only real termination requests. `beforeExit` fires whenever the event
    // loop merely runs dry — during startup, that made a failed port bind look
    // like "Graceful shutdown initiated by 0" with no mention of a port. And an
    // `exit` listener that calls process.exit(0) overwrites the code the
    // process was already exiting with, turning a failure into an apparent
    // success. Neither is a signal; neither belongs here.
    process.prependOnceListener('SIGINT', gracefulShutdown);
    process.prependOnceListener('SIGTERM', gracefulShutdown);

}

start();