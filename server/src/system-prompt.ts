/**
 * RP_PROMPT.md — the house system prompt new LLM configs start from.
 *
 * It teaches the block DSL and the `<replayed_history>` / `<current_input>` /
 * `<system_notice>` conventions, so a config without it produces a model that
 * doesn't know how to drive the game at all. Making it the default means a new
 * config works out of the box instead of needing a paste.
 *
 * Read at call time rather than import time so editing the file during dev
 * shows up on the next config you create, without a restart.
 */

import path from 'node:path'
import fs from 'node:fs'
import { getEmbeddedPrompts } from './embedded'

const FILENAME = 'RP_PROMPT.md'
const promptsDir = path.join(import.meta.dirname, 'prompts')

let warned = false

export function getDefaultSystemPrompt(): string {
    // Compiled builds have no source tree; build.ts packs this file alongside
    // the .macro templates.
    const embedded = getEmbeddedPrompts()?.get(FILENAME)
    if (embedded) return new TextDecoder().decode(embedded)

    const file = path.join(promptsDir, FILENAME)
    if (fs.existsSync(file)) return fs.readFileSync(file, 'utf-8')

    // Not fatal: a config with an empty system prompt still saves, it just
    // won't know the game's conventions until the user fills it in.
    if (!warned) {
        warned = true
        console.warn(`[SERVER] ${FILENAME} not found at ${file}; new configs will start with an empty system prompt.`)
    }
    return ''
}
