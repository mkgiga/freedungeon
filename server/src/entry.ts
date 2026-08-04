/**
 * Compile entry for the standalone binary. Not used when running from source —
 * that path starts at main.ts.
 *
 * This file is hand-written and stays that way: the single import below is the
 * whole embed surface, however many files the build packs into it. build.ts
 * writes dist/assets.blob before compiling this.
 *
 * Order matters. The natives must reach a real directory before anything
 * imports sharp or onnxruntime, so main.ts is pulled in dynamically at the end
 * rather than statically at the top.
 */

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
        // Native modules can't be loaded from the virtual filesystem: Windows
        // resolves a .node's dependent DLLs relative to the real directory it
        // sits in. Rewrite only when the size differs, so an upgraded binary
        // refreshes them but a normal start doesn't rewrite 46MB.
        const dest = path.join(NATIVE_DIR, key.slice(NATIVE_PREFIX.length))
        if (!fs.existsSync(dest) || fs.statSync(dest).size !== bytes.length) {
            fs.writeFileSync(dest, bytes)
        }
    } else if (key.startsWith(PROMPT_PREFIX)) {
        prompts.set(key.slice(PROMPT_PREFIX.length), bytes)
    } else if (key.startsWith(CLIENT_PREFIX)) {
        // Converted once, here, rather than per request. The explicit slice
        // honours byteOffset/byteLength instead of handing over `.buffer`,
        // which can be a larger pooled allocation.
        clientFiles.set(
            key.slice(CLIENT_PREFIX.length),
            bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
        )
    }
}

process.env.FREEDUNGEON_NATIVE_DIR = NATIVE_DIR
setEmbeddedAssets({ clientFiles, prompts })

await import('./main')
