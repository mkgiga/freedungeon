import type { ChatMessage, GameStateContext } from '@shared/types';
import { runTurn as runTurnShared, type SharedTurnResult } from '@shared/game-state';

export { createInitialContext, applyBlockToCtx } from '@shared/game-state';

export type TurnResult = SharedTurnResult & {
    systemPromptGameState: string;
    mostRecentUserMessageState: string;
};

let currentTurnResult: TurnResult | null = null;
export function setCurrentTurnResult(r: TurnResult | null) { currentTurnResult = r; }
export function getCurrentTurnResult() { return currentTurnResult; }

export function section(name: string, body: string): string {
    const commented = body
        .split('\n')
        .map(l => l.length > 0 ? `/// ${l}` : '///')
        .join('\n');
    return `/// --- ${name} ---\n${commented}`;
}

function sortMessages(messages: ChatMessage[]): ChatMessage[] {
    return [...messages].sort(
        (a, b) => (a.createdAt - b.createdAt) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
    );
}

/**
 * Server wrapper around the shared turn replay: extends the shared result with
 * the two transient prompt-injection strings the macro system consumes.
 */
export function runTurn(messages: ChatMessage[]): TurnResult {
    const shared = runTurnShared(messages);
    const { systemPromptGameState, mostRecentUserMessageState } = formatGameStateAsString(shared.ctx);
    return { ...shared, systemPromptGameState, mostRecentUserMessageState };
}

// ─────────────────────────────────────────────────────────────────────────────
// LEFT BLANK — user will implement.
// Returns the two transient strings injected at prompt-build time:
//   systemPromptGameState      → expanded into the system prompt at {{@GAME_STATE()}}
//   mostRecentUserMessageState → appended only to the final user message as
//                                 a `current-game-state` section
// ─────────────────────────────────────────────────────────────────────────────
export function formatGameStateAsString(_ctx: GameStateContext): {
    systemPromptGameState: string;
    mostRecentUserMessageState: string;
} {
    return { systemPromptGameState: '', mostRecentUserMessageState: '' };
}

export function buildHistoryForLLM(
    messages: ChatMessage[],
    turn: TurnResult,
): { role: 'user' | 'assistant' | 'system'; content: string }[] {
    const sorted = sortMessages(messages);

    let lastUserIdx = -1;
    for (let i = sorted.length - 1; i >= 0; i--) {
        if (sorted[i]!.role === 'user') { lastUserIdx = i; break; }
    }

    const out: { role: 'user' | 'assistant' | 'system'; content: string }[] = [];
    for (let i = 0; i < sorted.length; i++) {
        const m = sorted[i]!;
        if (m.role !== 'user') {
            out.push({ role: m.role, content: m.content });
            continue;
        }

        const prev = sorted[i - 1];
        const prevAssistantEffects =
            prev?.role === 'assistant' ? (turn.messageResults.get(prev.id) ?? []) : [];
        const thisUserEffects = turn.messageResults.get(m.id) ?? [];

        const parts: string[] = [];
        if (prevAssistantEffects.length > 0) {
            parts.push(section('last-assistant-effects', prevAssistantEffects.join('\n')));
        }
        // user-input is raw JS — no comment wrapper so the LLM sees it as
        // executable content, not contextual notes.
        parts.push(m.content);
        if (thisUserEffects.length > 0) {
            parts.push(section('user-effects', thisUserEffects.join('\n')));
        }
        if (i === lastUserIdx && turn.mostRecentUserMessageState.trim().length > 0) {
            parts.push(section('current-game-state', turn.mostRecentUserMessageState));
        }

        out.push({ role: 'user', content: parts.join('\n') });
    }
    return out;
}
