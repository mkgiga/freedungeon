import { brightBlue, brightGreen, ComfyLogger, green, rgb, style, yellow } from 'comfylogger';

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