import type { ChatMessage, GameStateContext } from '@shared/types';
import { parseBlocks } from '../blocks';
import { createInitialContext, applyBlockToCtx } from './scope';

export { createInitialContext, createScope, applyBlockToCtx } from './scope';
export type { ScopeBinding } from './scope';

export type SharedTurnResult = {
    ctx: GameStateContext;
    messageResults: Map<string, string[]>;
};

function sortMessages(messages: ChatMessage[]): ChatMessage[] {
    return [...messages].sort(
        (a, b) => (a.createdAt - b.createdAt) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
    );
}

/**
 * Replay every message's command calls from a fresh ctx. Pure: same input →
 * same output. Lives in shared/ so the client can run the same logic against
 * a partial message tail during visual-novel-style playback.
 *
 * Replays via parseBlocks (cached per content string) + applyBlockToCtx
 * rather than eval'ing each message's content — content is always pure
 * block-call JS (written only through serializeBlocks and friends), so the
 * block list captures everything the old `new Function` execution did.
 */
export function runTurn(messages: ChatMessage[]): SharedTurnResult {
    const sorted = sortMessages(messages);
    const ctx = createInitialContext();
    const messageResults = new Map<string, string[]>();

    for (const msg of sorted) {
        const arr: string[] = [];
        for (const block of parseBlocks(msg.content)) {
            applyBlockToCtx(ctx, block, arr);
        }
        messageResults.set(msg.id, arr);
    }

    return { ctx, messageResults };
}
