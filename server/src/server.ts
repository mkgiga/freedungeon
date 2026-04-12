import config from '../config.json' with { type: "json" };
import { createStore, produce } from "solid-js/store";
import { isPrivateIP } from './utils/net';
import { Hono } from "hono";
import { cors } from "hono/cors";
import { getConnInfo } from "hono/bun";
import { log } from './logger';
import { initDb, saveStateToDb, loadStateFromDb } from './db';
import { loadPreferences, savePreferences } from './preferences';
import { Server, Socket } from "socket.io";
import { createServer } from 'node:http';
import { createEffect } from 'solid-js';
import { trpcServer } from '@hono/trpc-server';
import { appRouter } from './v2/router';
import { uploadsRouter } from './v2/uploads';
import type { AppState, CurrentChatState } from '@shared/types';
import { z } from 'zod';
import { notification } from './notifications';
import { nanoid } from 'nanoid';

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
        llmConfigs: {},
        chats: {},
    },
    currentChat: {
        id: null,
        title: "",
        assets: {
            actors: [],
            notes: [],
        },
        messages: {},
        createdAt: null,
        updatedAt: null,
    } as CurrentChatState,
    notifications: [],
    userPreferences: {
        theme: "system",
        playerCharacterId: null,
        activeLLMConfigId: null,
    }
} as AppState);


export function setState(...args: any[]) {
    (_setState as Function)(...args);
    const value = args.at(-1);
    const path = args.slice(0, -1);
    io.emit('state', { path, value });
}

export function deleteState(...path: string[]) {
    const key = path.at(-1)!;
    const parentPath = path.slice(0, -1);
    _setState(produce((s: any) => {
        let target = s;
        for (const p of parentPath) target = target[p];
        delete target[key];
    }));
    io.emit('delete', { path: parentPath, key });
}

function start() {
    (async () => {
        await initDb();
        const loaded = await loadStateFromDb();
        setState('assets', loaded.assets);
        setState('userPreferences', loadPreferences());
        await initProcessHandlers();
        await initHttp();
        await initWebSocket();
        await listen();
    })();
}

async function listen() {
    app.route('/uploads', uploadsRouter);
    app.use('/trpc/*', trpcServer({ router: appRouter }));
    Bun.serve({
        port: config.server.port || 8078,
        hostname: config.server.hostname || "0.0.0.0",
        fetch: app.fetch,
    });

    httpServer.listen(config.server.wsPort || 8079);

    log.server.ok(`Server is listening on ${config.server.hostname === '0.0.0.0' ? 'http://localhost' : `http://${config.server.hostname}`}:${config.server.port}`);
}

async function initHttp() {
    app.use('*', cors({ origin: '*' }));
    app.use('*', async (c, next) => {
        const info = getConnInfo(c);
        const clientIp = info.remote.address;
        console.log('Client IP:', JSON.stringify(clientIp), 'isPrivate:', clientIp ? isPrivateIP(clientIp) : 'no ip');
        if (clientIp && isPrivateIP(clientIp)) {
            return next();
        }
        return c.text('Who are you?', 403);
    });
}

const activeSockets = new Set<Socket>();
async function initWebSocket() {
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

    const gracefulShutdown = (signal: string) => {
        console.log(signal);
        if (shuttingDown) return;
        console.log(`Graceful shutdown initiated by ${signal}...`);
        shuttingDown = true;


        console.log(`Received ${signal}, shutting down...`)
        clearInterval(autoSaveInterval)

        for (const socket of activeSockets) {
            socket.disconnect(true)
        }

        savePreferences(state.userPreferences)
        saveStateToDb({ state })
        console.log('State saved, exiting now.')
        process.exit(0)
    }

    process.prependOnceListener('beforeExit', gracefulShutdown);
    process.prependOnceListener('exit', gracefulShutdown);
    process.prependOnceListener('SIGINT', gracefulShutdown);
    process.prependOnceListener('SIGTERM', gracefulShutdown);

    // Periodic auto-save — primary persistence mechanism
    // Bun on Windows doesn't reliably fire SIGINT/SIGTERM handlers
    const autoSaveInterval = setInterval(() => {
        try {
            saveStateToDb({ state })
            savePreferences(state.userPreferences)
            log.server.info('Auto-save complete.')
        } catch (err) {
            log.server.error(`Auto-save failed: ${err}`)
        }
    }, 30_000)
}

start();