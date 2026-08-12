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


// Patch generation for `mutate`. Auto-freeze must be off: Solid's store mutates
// in place, and a frozen result would throw the first time anything touched it.
enablePatches();
setAutoFreeze(false);

/**
 * Edit application state by mutating a draft.
 *
 * The one funnel, in the form callers actually want:
 *
 *     mutate(d => { d.currentChat.gameState.itemDefs[key].icon = url })
 *
 * instead of spelling the path out as arguments. Immer records exactly which
 * leaves changed and hands back patches whose `path` is the same array
 * `persistPath` and the socket already speak — so this is a nicer front door
 * onto the existing machinery, not a new protocol. Several edits in one call
 * become several precise patches, not one coarse whole-object write.
 *
 * It also removes the sharp edge that `setState` has: a draft creates
 * intermediate objects as you assign them, so `d.a.b = { c: 1 }` works whether
 * or not `a.b` existed, and the emitted patch always targets a parent that does.
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

/**
 * Write a value at a path, REPLACING rather than merging.
 *
 * `setStore(path, obj)` merges an object into whatever is already there, so
 * keys the new value dropped would survive — assigning a rebuilt map would
 * leave the removed entries behind. Immer emits one `replace` patch for a
 * whole-object assignment, and it has to mean replace. Scalars take the plain
 * path write, which has no such ambiguity.
 */
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

/**
 * Remove one key, with the same semantics `deleteState` has — including the
 * cascade rules, which exist in the store rather than only in the database
 * (see cascade.ts) and would otherwise be skipped by a mutate-driven delete.
 *
 * Goes through `produce` because Solid's setStore MERGES a plain object rather
 * than replacing it, so handing it a copy with the key missing silently does
 * nothing.
 */
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
 * The low-level path write. `mutate` is the API for application code — this
 * stays for the few places a path is genuinely dynamic (the cascade callbacks
 * below, whose root is a variable) and for the boot writes, where setStore's
 * MERGE semantics are load-bearing: `setState('userPreferences', loaded)` keeps
 * any key the initial store declared that the stored file predates, whereas an
 * assignment would drop it.
 *
 * That merge/replace difference is the one behavioural gap between the two, and
 * the reason this wasn't simply deleted.
 */
export function setState(...args: any[]) {
    (_setState as Function)(...args);
    const path = args.slice(0, -1);
    persistPath(path);
    // Emit what the state now IS at this path, not the argument that produced
    // it. Identical for a plain value, and the only correct thing for a
    // `produce(...)` writer — whose last argument is a function, and would
    // otherwise be put on the wire as one.
    io.emit('state', { path, value: readPath(path) });
}

/** Current value at a state path, or undefined if any level is missing. */
function readPath(path: unknown[]): unknown {
    let node: any = state;
    for (const part of path) {
        if (node == null) return undefined;
        node = node[part as keyof typeof node];
    }
    return node;
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

/**
 * Give every declaring feature its bag, defaults merged over what was stored.
 *
 * Not just a convenience: Solid's setState cannot create intermediate objects,
 * so `setState('extensionState', 'myext', 'counter', 1)` throws unless
 * `extensionState.myext` already exists. Seeding here is what makes an
 * extension's ordinary nested writes work at all — and it applies defaults on
 * read the same way feature settings do, so a variable added in a later version
 * arrives without a migration.
 */
function seedExtensionState(stored: Record<string, Record<string, unknown>>) {
    const keys = new Set([...Object.keys(FEATURES), ...Object.keys(stored ?? {})]);
    for (const key of keys) {
        const declared = FEATURES[key]?.state
        // Keep rows for an extension we no longer know about: it may just be
        // switched off or mid-upgrade, and dropping its data would be worse
        // than carrying it.
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
        await refreshDependencies();
        await loadExtensions();
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
    const httpsEnabled = process.env.FREEDUNGEON_HTTPS === '1' || (config.server as { https?: boolean }).https === true;
    // The client derives its socket port as "served port + 1" from
    // window.location, so the TLS pair has to stay adjacent for wss to land.
    const httpsPort = Number(process.env.FREEDUNGEON_HTTPS_PORT) || (config.server as { httpsPort?: number }).httpsPort || 8443;

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

    // Opt-in TLS listener for LAN devices. Deliberately after the HTTP listener
    // is already up and outside its try/catch: this is an enhancement, and no
    // failure in it may cost the user the app. See tls.ts for why the
    // certificate is public and what that does and doesn't buy.
    if (httpsEnabled) {
        await startHttpsListener(hostname, httpsPort);
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

/**
 * Bring up the HTTPS pair: the Hono app over TLS, and socket.io alongside it.
 *
 * Both halves are required. A page served over https can't open a `ws://`
 * socket — the browser blocks it as mixed content — so the socket needs its own
 * TLS listener, attached to the same `io` instance so both origins share one
 * set of rooms and handlers.
 */
async function startHttpsListener(hostname: string, httpsPort: number): Promise<void> {
    const tls = await ensureCert();
    if (!tls) return;

    const wssPort = httpsPort + 1;
    try {
        Bun.serve({ port: httpsPort, hostname, tls: { cert: tls.cert, key: tls.key }, fetch: app.fetch });
        const wssServer = createHttpsServer({ cert: tls.cert, key: tls.key });
        // attach, not construct: one io, two transports.
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