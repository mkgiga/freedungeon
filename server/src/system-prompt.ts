
import path from 'node:path'
import fs from 'node:fs'
import { getEmbeddedPrompts } from './embedded'

const promptsDir = path.join(import.meta.dirname, 'prompts')

const warned = new Set<string>()

function readPrompt(filename: string): string {
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

