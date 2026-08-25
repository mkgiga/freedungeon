
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'

export const DATA_DIR = process.env.FREEDUNGEON_DATA_DIR
    ? path.resolve(process.env.FREEDUNGEON_DATA_DIR)
    : path.join(os.homedir(), '.freedungeon')

export const DB_DIR = path.join(DATA_DIR, 'db')
export const DB_PATH = path.join(DB_DIR, 'db.sqlite')
export const MODELS_DIR = path.join(DATA_DIR, 'models')
export const UPLOADS_DIR = path.join(DATA_DIR, 'uploads')
export const THUMBS_DIR = path.join(UPLOADS_DIR, 'thumbs')
export const DEBUG_DIR = path.join(DATA_DIR, 'debug')
export const PREFS_PATH = path.join(DATA_DIR, 'preferences.json')
/**
 * Where a compiled binary extracts its bundled native modules. They can't be
 * loaded from the virtual filesystem — Windows resolves a `.node`'s dependent
 * DLLs relative to the real directory it sits in.
 */
export const NATIVE_DIR = path.join(DATA_DIR, 'native')

/**
 * Create the whole tree if it isn't there. Called once at startup so a fresh
 * install lands on a complete directory structure instead of each consumer
 * racing to mkdir its own corner on first write.
 */
export function ensureDataDirs(): void {
    for (const dir of [DATA_DIR, DB_DIR, MODELS_DIR, UPLOADS_DIR, THUMBS_DIR, DEBUG_DIR]) {
        fs.mkdirSync(dir, { recursive: true })
    }
}
