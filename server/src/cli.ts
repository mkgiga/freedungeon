/**
 * Launch-parameter parsing, run as a pre-init pass before any application
 * module loads.
 *
 * The ordering is the whole point. Several modules resolve configuration at
 * IMPORT time — `paths.ts` computes `DATA_DIR` from the environment the moment
 * it's first imported, and everything that touches the database or uploads
 * imports it transitively. So a flag like `--data-dir` has to be parsed and
 * applied before that first import happens, which is why this lives in its own
 * module with no application imports at all (only `node:util` and
 * `node:path`). Importing anything from the app here would defeat it.
 *
 * On naive parsing: `process.argv.includes('--agent')` looks fine and isn't.
 * It matches the flag anywhere, including where it is a *value*
 * (`--data-dir --agent`) or a positional, so a path or chat title containing
 * the string silently changes what the process does. `util.parseArgs` knows
 * which tokens are values and which are flags.
 *
 * On argv shape: `bun script.ts` and a compiled binary both put two entries
 * before the real arguments, so `parseArgs`'s default `slice(2)` is correct in
 * both — verified, not assumed. What differs is those first two entries: in a
 * compiled binary `argv[0]` is the literal string "bun" and `argv[1]` is a
 * `B:/~BUN/root/...` virtual path. Neither locates anything on disk; use
 * `process.execPath` for that.
 */

import { parseArgs } from 'node:util'
import path from 'node:path'

export type LaunchOptions = {
    /** Run the bundled agent instead of the server (internal; set on re-exec). */
    agent: boolean
    /** Override the data directory root. */
    dataDir?: string
    port?: number
    wsPort?: number
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
  --host <addr>       Bind address (default: 0.0.0.0)
  -h, --help          Show this message
  -v, --version       Print the version

Environment:
  FREEDUNGEON_DATA_DIR   Same as --data-dir; the flag wins when both are set.
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
            host: { type: 'string' },
            help: { type: 'boolean', short: 'h', default: false },
            version: { type: 'boolean', short: 'v', default: false },
        },
        // Reject unknown flags: silently ignoring a misspelling is how someone
        // ends up wondering why --datadir didn't move their database.
        strict: true,
        allowPositionals: false,
    })

    return {
        agent: values.agent === true,
        dataDir: values['data-dir'] ? path.resolve(values['data-dir']) : undefined,
        port: toPort(values.port, '--port'),
        wsPort: toPort(values['ws-port'], '--ws-port'),
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
    if (opts.port !== undefined) {
        process.env.FREEDUNGEON_PORT = String(opts.port)
        // The client derives the socket port from the one it was served on
        // (port + 1), so moving the HTTP port has to move its partner — or the
        // app renders perfectly and silently never syncs. An explicit
        // --ws-port below still wins.
        process.env.FREEDUNGEON_WS_PORT = String(opts.port + 1)
    }
    if (opts.wsPort !== undefined) process.env.FREEDUNGEON_WS_PORT = String(opts.wsPort)
    if (opts.host) process.env.FREEDUNGEON_HOST = opts.host
}

export { USAGE }
