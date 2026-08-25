
import blobFile from '../dist/assets.blob' with { type: 'file' }
import fs from 'node:fs'
import path from 'node:path'
import { unpackBlob } from './asset-blob'
import { setEmbeddedAssets } from './embedded'
import { NATIVE_DIR, ensureDataDirs } from './paths'

const NATIVE_PREFIX = 'native/'
const PROMPT_PREFIX = 'prompt/'
const CLIENT_PREFIX = 'client/'

const assets = unpackBlob(fs.readFileSync(blobFile))

ensureDataDirs()
fs.mkdirSync(NATIVE_DIR, { recursive: true })

const clientFiles = new Map<string, ArrayBuffer>()
const prompts = new Map<string, Buffer>()

for (const [key, bytes] of assets) {
    if (key.startsWith(NATIVE_PREFIX)) {
        const dest = path.join(NATIVE_DIR, key.slice(NATIVE_PREFIX.length))
        if (!fs.existsSync(dest) || fs.statSync(dest).size !== bytes.length) {
            fs.writeFileSync(dest, bytes)
        }
    } else if (key.startsWith(PROMPT_PREFIX)) {
        prompts.set(key.slice(PROMPT_PREFIX.length), bytes)
    } else if (key.startsWith(CLIENT_PREFIX)) {
        clientFiles.set(
            key.slice(CLIENT_PREFIX.length),
            bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
        )
    }
}

process.env.FREEDUNGEON_NATIVE_DIR = NATIVE_DIR
setEmbeddedAssets({ clientFiles, prompts })

await import('./main')
