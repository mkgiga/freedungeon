import type { ChatMessage, GameStateContext } from '@shared/types';
import { createInitialContext, createScope } from './scope';

export { createInitialContext, createScope, applyBlockToCtx } from './scope';
export type { ScopeBinding } from './scope';

export type SharedTurnResult = {
    ctx: GameStateContext;
    /** Per-message side-effect log (e.g., "Received 1x Potion"). Server uses it
     *  to inject `last-assistant-effects` / `user-effects` sections into the
     *  prompt; client doesn't need it but is welcome to ignore it. */
    messageResults: Map<string, string[]>;
};

function sortMessages(messages: ChatMessage[]): ChatMessage[] {
    return [...messages].sort(
        (a, b) => (a.createdAt - b.createdAt) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
    );
}

export function executeContent(content: string, scope: Record<string, unknown>): void {
    const names = Object.keys(scope);
    const vals = Object.values(scope);
    try {
        new Function(...names, `"use strict";\n${content}`)(...vals);
    } catch (err) {
        console.warn('[game-state] executor error:', err);
    }
}

/**
 * Replay every message's command calls from a fresh ctx. Pure: same input →
 * same output. Lives in shared/ so the client can run the same logic against
 * a partial message tail during visual-novel-style playback.
 */
export function runTurn(messages: ChatMessage[]): SharedTurnResult {
    const sorted = sortMessages(messages);
    const ctx = createInitialContext();
    const messageResults = new Map<string, string[]>();

    for (const msg of sorted) {
        const arr: string[] = [];
        const scope = createScope({ ctx, arr });
        executeContent(msg.content, scope);
        messageResults.set(msg.id, arr);
    }

    return { ctx, messageResults };
}
