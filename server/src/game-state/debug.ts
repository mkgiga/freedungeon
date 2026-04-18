import path from 'path';
import fs from 'fs';

const DEBUG_DIR = path.join(import.meta.dirname, '..', '..', 'debug');

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
