
import { parseArgs } from 'node:util'
import path from 'node:path'

export type LaunchOptions = {
    agent: boolean
    dataDir?: string
    port?: number
    wsPort?: number
    https: boolean
    httpsPort?: number
    host?: string
    help: boolean
    version: boolean
}

const USAGE = `freedungeon — an LLM-driven roleplaying server

Usage: freedungeon [options]

Options:
  --data-dir <path>   Where chats, uploads and settings live (default: ~/.freedungeon)
  --port <n>          HTTP port (default: 8078)
  --ws-port <n>       WebSocket port (default: 8079)
  --https             Also serve HTTPS, so phones can install the app (see below)
  --https-port <n>    HTTPS port (default: 8443; its socket uses the next port)
  --host <addr>       Bind address (default: 0.0.0.0)
  -h, --help          Show this message
  -v, --version       Print the version

Environment:
  FREEDUNGEON_DATA_DIR   Same as --data-dir; the flag wins when both are set.
  FREEDUNGEON_HTTPS=1    Same as --https, for launchers that can't pass flags.

HTTPS on a LAN:
  --https fetches a publicly-trusted certificate for *.my.local-ip.co and
  serves on https://<your-dashed-ip>.my.local-ip.co:8443 — the address is
  printed at startup. Nothing needs installing on the phone. The certificate's
  private key is published by that service, so the connection is trusted but
  NOT private: use it on a network you trust.
`

function toPort(raw: string | undefined, flag: string): number | undefined {
    if (raw === undefined) return undefined
    const n = Number(raw)
    if (!Number.isInteger(n) || n < 1 || n > 65535) {
        throw new Error(`${flag} must be a port number between 1 and 65535, got "${raw}"`)
    }
    return n
}

/**
 * Parse launch options. Throws on malformed input rather than guessing — a
 * typo'd flag that silently did nothing would be worse than a startup error.
 */
export function parseLaunchOptions(argv?: string[]): LaunchOptions {
    const { values } = parseArgs({
        args: argv,
        options: {
            agent: { type: 'boolean', default: false },
            'data-dir': { type: 'string' },
            port: { type: 'string' },
            'ws-port': { type: 'string' },
            https: { type: 'boolean', default: false },
            'https-port': { type: 'string' },
            host: { type: 'string' },
            help: { type: 'boolean', short: 'h', default: false },
            version: { type: 'boolean', short: 'v', default: false },
        },
        strict: true,
        allowPositionals: false,
    })

    return {
        agent: values.agent === true,
        dataDir: values['data-dir'] ? path.resolve(values['data-dir']) : undefined,
        port: toPort(values.port, '--port'),
        wsPort: toPort(values['ws-port'], '--ws-port'),
        https: values.https === true,
        httpsPort: toPort(values['https-port'], '--https-port'),
        host: values.host,
        help: values.help === true,
        version: values.version === true,
    }
}

/**
 * Publish the options that later modules read at import time. This must run
 * before those modules are imported; see the note at the top of the file.
 */
export function applyLaunchOptions(opts: LaunchOptions): void {
    if (opts.dataDir) process.env.FREEDUNGEON_DATA_DIR = opts.dataDir
    if (opts.https) process.env.FREEDUNGEON_HTTPS = '1'
    if (opts.httpsPort !== undefined) process.env.FREEDUNGEON_HTTPS_PORT = String(opts.httpsPort)
    if (opts.port !== undefined) {
        process.env.FREEDUNGEON_PORT = String(opts.port)
        process.env.FREEDUNGEON_WS_PORT = String(opts.port + 1)
    }
    if (opts.wsPort !== undefined) process.env.FREEDUNGEON_WS_PORT = String(opts.wsPort)
    if (opts.host) process.env.FREEDUNGEON_HOST = opts.host
}

export { USAGE }
