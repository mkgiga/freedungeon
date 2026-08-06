/**
 * Prompt files that ship with the server, read from src/prompts.
 *
 *  - RP_PROMPT.md     — the house system prompt new LLM configs start from. It
 *                       teaches the block DSL and the `<replayed_history>` /
 *                       `<current_input>` / `<system_notice>` conventions, so a
 *                       config without it produces a model that doesn't know how
 *                       to drive the game at all.
 *  - SCENARIO_AGENT.md — instructions for the scenario collaborator.
 *
 * Kept as files rather than string literals so they can be read and edited like
 * prose, without a rebuild to see the change.
 *
 * Read at call time rather than import time so editing one during dev shows up
 * on the next use, without a restart.
 */

import path from 'node:path'
import fs from 'node:fs'
import { getEmbeddedPrompts } from './embedded'

const promptsDir = path.join(import.meta.dirname, 'prompts')

const warned = new Set<string>()

/**
 * A prompt file's contents, or '' if it's missing.
 *
 * Missing is never fatal — an empty system prompt still saves and still runs, it
 * just behaves worse — so this warns once per file rather than throwing.
 */
function readPrompt(filename: string): string {
    // Compiled builds have no source tree; build.ts packs these alongside the
    // .macro templates.
    const embedded = getEmbeddedPrompts()?.get(filename)
    if (embedded) return new TextDecoder().decode(embedded)

    const file = path.join(promptsDir, filename)
    if (fs.existsSync(file)) return fs.readFileSync(file, 'utf-8')

    if (!warned.has(filename)) {
        warned.add(filename)
        console.warn(`[SERVER] ${filename} not found at ${file}.`)
    }
    return ''
}

export function getDefaultSystemPrompt(): string {
    return readPrompt('RP_PROMPT.md')
}

export function getScenarioAgentPrompt(): string {
    return readPrompt('SCENARIO_AGENT.md')
}
