import path from 'path';
import fs from 'fs';
import type { ModelMessage } from 'ai';
import type { LastPromptMessage } from '@shared/types';
import { DEBUG_DIR } from '../paths';

function ensureDir() {
    if (!fs.existsSync(DEBUG_DIR)) {
        fs.mkdirSync(DEBUG_DIR, { recursive: true });
    }
}

function replacer(_key: string, value: unknown) {
    if (value instanceof Map) return Object.fromEntries(value);
    return value;
}

export function writeDebug(name: string, data: unknown): void {
    try {
        ensureDir();
        const payload = JSON.stringify(data, replacer, 2);
        fs.writeFileSync(path.join(DEBUG_DIR, `${name}.json`), payload, 'utf-8');
    } catch (err) {
        console.warn(`[debug] failed to write ${name}.json:`, err);
    }
}

export function writeDebugMd(name: string, content: string): void {
    try {
        ensureDir();
        fs.writeFileSync(path.join(DEBUG_DIR, `${name}.md`), content, 'utf-8');
    } catch (err) {
        console.warn(`[debug] failed to write ${name}.md:`, err);
    }
}

type ChatMsg = { role: string; content: string };
type RequestDump = {
    systemPrompt: string;
    history: ChatMsg[];
    llmConfig: { name: string; provider: string; model: string };
};

function safeJson(v: unknown): string {
    if (v === undefined) return '';
    try { return typeof v === 'string' ? v : JSON.stringify(v); }
    catch { return String(v); }
}

/**
 * Flatten an AI-SDK `ModelMessage` into a single readable `{ role, content }`
 * string for the debug view. `content` is `string | part[]`; parts are text,
 * tool calls, or tool results (assistant/tool turns). Structured parts are
 * rendered as `[tool-call name(args)]` / `[tool-result name: output]` so the
 * agent's actual tool interactions are visible in the history dump.
 */
export function normalizeModelMessage(m: ModelMessage): LastPromptMessage {
    const role = String(m.role);
    const content = m.content;
    if (typeof content === 'string') return { role, content };
    if (!Array.isArray(content)) return { role, content: '' };
    const parts = (content as any[]).map((p) => {
        switch (p?.type) {
            case 'text': return p.text ?? '';
            case 'reasoning': return p.text != null ? `[reasoning] ${p.text}` : '';
            case 'tool-call': return `[tool-call ${p.toolName}(${safeJson(p.input ?? p.args)})]`;
            case 'tool-result': return `[tool-result ${p.toolName}: ${safeJson(p.output ?? p.result)}]`;
            case 'image': return '[image]';
            case 'file': return `[file ${p.mediaType ?? ''}]`;
            default: return p?.type ? `[${p.type}]` : '';
        }
    });
    return { role, content: parts.filter(Boolean).join('\n') };
}

export function formatRequestAsText(req: RequestDump): string {
    const sections: string[] = [];

    sections.push('========== LLM CONFIG ==========');
    sections.push(`name:     ${req.llmConfig.name}`);
    sections.push(`provider: ${req.llmConfig.provider}`);
    sections.push(`model:    ${req.llmConfig.model}`);
    sections.push('');

    sections.push('========== SYSTEM PROMPT ==========');
    sections.push(req.systemPrompt || '(empty)');
    sections.push('');

    sections.push(`========== HISTORY (${req.history.length} message${req.history.length === 1 ? '' : 's'}) ==========`);
    req.history.forEach((m, i) => {
        sections.push('');
        sections.push(`----- [${i + 1}] ${m.role} -----`);
        sections.push(m.content);
    });

    return sections.join('\n');
}
