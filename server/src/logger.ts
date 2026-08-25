import { brightBlue, brightGreen, ComfyLogger, green, rgb, style, yellow } from 'comfylogger';
import { networkInterfaces, homedir } from 'node:os';

const dbLogger = new ComfyLogger({
    name: 'db',
});
const apiLogger = new ComfyLogger({
    name: 'api',
});
const wsLogger = new ComfyLogger({
    name: 'ws',
});
const serverLogger = new ComfyLogger({
    name: 'server',
});

const okStyle = style((text) => {
    return brightGreen(text);
});
const warningStyle = style((text) => {
    return yellow(text);
});
const errorStyle = style((text) => {
    return rgb(255, 69, 0, text);
});
const infoStyle = style((text) => {
    return brightBlue(text);
});

const dbPrefix = (styleFn: (text: string) => string, string: string) => `${styleFn('[DB]')} ${string}`;

export const log = {
    db: {
        ok: (message: string) => dbLogger.log(dbPrefix(okStyle, message)),
        warn: (message: string) => dbLogger.log(dbPrefix(warningStyle, message)),
        error: (message: string) => dbLogger.log(dbPrefix(errorStyle, message)),
        info: (message: string) => dbLogger.log(dbPrefix(infoStyle, message)),
    },
    api: {
        ok: (message: string) => apiLogger.log(okStyle(`[API] ${message}`)),
        warn: (message: string) => apiLogger.log(warningStyle(`[API] ${message}`)),
        error: (message: string) => apiLogger.log(errorStyle(`[API] ${message}`)),
        info: (message: string) => apiLogger.log(infoStyle(`[API] ${message}`)),
    },
    ws: {
        ok: (message: string) => wsLogger.log(okStyle(`[WS] ${message}`)),
        warn: (message: string) => wsLogger.log(warningStyle(`[WS] ${message}`)),
        error: (message: string) => wsLogger.log(errorStyle(`[WS] ${message}`)),
        info: (message: string) => wsLogger.log(infoStyle(`[WS] ${message}`)),
    },
    server: {
        ok: (message: string) => serverLogger.log(okStyle(`[SERVER] ${message}`)),
        warn: (message: string) => serverLogger.log(warningStyle(`[SERVER] ${message}`)),
        error: (message: string) => serverLogger.log(errorStyle(`[SERVER] ${message}`)),
        info: (message: string) => serverLogger.log(infoStyle(`[SERVER] ${message}`)),
    },
}

log.db.info('Logger initialized');

export function startupBanner(info: {
    version: string
    host: string
    port: number
    agentPort: number
    dataDir: string
}): void {
    const dim_ = (s: string) => rgb(120, 120, 130, s)
    const accent = (s: string) => rgb(180, 140, 255, s)
    const url = (s: string) => brightBlue(s)

    const rows: Array<[string, string]> = [
        ['Play', `http://localhost:${info.port}`],
    ]

    if (info.host === '0.0.0.0') {
        const lan = lanAddress()
        if (lan) rows.push(['Network', `http://${lan}:${info.port}`])
    }
    rows.push(['Agent', `http://127.0.0.1:${info.agentPort}`])
    rows.push(['Data', tildify(info.dataDir)])

    const title = ` freedungeon ${dim_(`v${info.version}`)} `
    const titleWidth = ` freedungeon v${info.version} `.length
    const urlWidth = Math.max(...rows
        .filter(([, v]) => v.startsWith('http'))
        .map(([k, v]) => k.length + v.length + 4))
    const width = Math.max(titleWidth, urlWidth)

    console.log('')
    console.log(accent(`  ╭${'─'.repeat(width)}╮`))
    console.log(accent('  │') + title + ' '.repeat(width - titleWidth) + accent('│'))
    console.log(accent(`  ╰${'─'.repeat(width)}╯`))
    for (const [label, value] of rows) {
        const isUrl = value.startsWith('http')
        console.log(`   ${dim_(label.padEnd(9))}${isUrl ? url(value) : dim_(value)}`)
    }
    console.log('')
}

function tildify(p: string): string {
    const home = homedir()
    return p.startsWith(home) ? `~${p.slice(home.length)}` : p
}

function lanAddress(): string | null {
    for (const addresses of Object.values(networkInterfaces())) {
        for (const addr of addresses ?? []) {
            if (addr.family === 'IPv4' && !addr.internal) return addr.address
        }
    }
    return null
}