import type { GameStateContext, ActorGameState } from '@shared/types';

const DEFAULT_ACTOR_HP = 100;

export function createInitialContext(): GameStateContext {
    return {
        inventory: {},
        scene: {
            actors: {
                active: {},
                offscreen: {},
            },
        },
    };
}

export type ScopeBinding = { ctx: GameStateContext; arr: string[] };

function findActor(ctx: GameStateContext, id: string):
    { bucket: 'active' | 'offscreen'; entry: ActorGameState } | null {
    const active = ctx.scene.actors.active[id];
    if (active) return { bucket: 'active', entry: active };
    const offscreen = ctx.scene.actors.offscreen[id];
    if (offscreen) return { bucket: 'offscreen', entry: offscreen };
    return null;
}

/** Moves actor into active scene, restoring from offscreen if known. Returns true if state changed. */
function ensureActive(ctx: GameStateContext, id: string): boolean {
    if (ctx.scene.actors.active[id]) return false;
    const restored = ctx.scene.actors.offscreen[id];
    if (restored) {
        ctx.scene.actors.active[id] = restored;
        delete ctx.scene.actors.offscreen[id];
    } else {
        ctx.scene.actors.active[id] = { hp: DEFAULT_ACTOR_HP };
    }
    return true;
}

export function createScope({ ctx, arr }: ScopeBinding) {
    return {
        // ── Display-only (mirror client/src/components/chat/blocks.ts) ────
        unformatted: (_text: string) => {},
        text: (_text: string) => {},
        speech: (customId: string, _text: string, _opts?: object) => {
            ensureActive(ctx, customId);
        },
        pause: (_seconds: number) => {},
        image: (_opts: object) => {},
        webview: (_html: string, _opts?: object) => {},
        noOpContinue: () => {},

        // ── Inventory (party-wide) ────────────────────────────────────────
        giveItem: (name: string, qty: number = 1) => {
            ctx.inventory[name] = (ctx.inventory[name] ?? 0) + qty;
            arr.push(`Received ${qty}x ${name}`);
        },
        takeItem: (name: string, qty: number = 1) => {
            const current = ctx.inventory[name] ?? 0;
            const taken = Math.min(current, qty);
            ctx.inventory[name] = current - taken;
            if (taken > 0) arr.push(`Lost ${taken}x ${name}`);
        },

        // ── Scene management ──────────────────────────────────────────────
        enterActors: (...customIds: string[]) => {
            for (const id of customIds) {
                if (ensureActive(ctx, id)) arr.push(`${id} entered the scene`);
            }
        },
        leaveActors: (...customIds: string[]) => {
            for (const id of customIds) {
                const entry = ctx.scene.actors.active[id];
                if (!entry) continue;
                ctx.scene.actors.offscreen[id] = entry;
                delete ctx.scene.actors.active[id];
                arr.push(`${id} left the scene`);
            }
        },

        // ── Per-actor HP ──────────────────────────────────────────────────
        setHp: (customId: string, value: number) => {
            const found = findActor(ctx, customId);
            if (found) {
                found.entry.hp = value;
            } else {
                ctx.scene.actors.active[customId] = { hp: value };
            }
        },
        damage: (customId: string, amount: number) => {
            const found = findActor(ctx, customId);
            if (!found) return;
            found.entry.hp = Math.max(0, found.entry.hp - amount);
            arr.push(`${customId} took ${amount} damage (HP: ${found.entry.hp})`);
        },
        heal: (customId: string, amount: number) => {
            const found = findActor(ctx, customId);
            if (!found) return;
            found.entry.hp = found.entry.hp + amount;
            arr.push(`${customId} healed ${amount} (HP: ${found.entry.hp})`);
        },
        attack: (_target: string) => {},
    } as const;
}
