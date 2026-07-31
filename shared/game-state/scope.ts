import type { GameStateContext, ActorGameState } from '@shared/types';
import type { Block } from '@shared/blocks';

const DEFAULT_ACTOR_HP = 100;

export function createInitialContext(): GameStateContext {
    return {
        inventory: {},
        itemDefs: {},
        scene: {
            actors: {
                active: {},
                offscreen: {},
            },
        },
        flags: {},
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
        // ── Display-only (mirror shared/blocks.ts) ────────────────────────
        unformatted: (_text: string) => {},
        text: (_text: string) => {},
        speech: (customIdOrDialogue: string, textOrOpts?: string | object, _opts?: object) => {
            // Two forms:
            //   predefined: speech(customId, dialogue, opts?)   — arg 2 is a string
            //   ad-hoc:     speech(dialogue, { name })          — arg 2 is an object
            // Only the predefined form carries a customId worth tracking.
            if (typeof textOrOpts === 'string') {
                ensureActive(ctx, customIdOrDialogue);
            }
        },
        pause: (_seconds: number) => {},
        image: (_opts: object) => {},
        webview: (_html: string, _opts?: object) => {},
        noOpContinue: () => {},
        choicePrompt: (_options: string[]) => {},
        choice: (_text: string) => {},
        // A use *attempt* (drag-and-drop user event) — no state change; the
        // agent's answering useItem block carries the actual consumption.
        tryUse: (_opts: { what: string; on: string }) => {},

        // ── Item definitions ──────────────────────────────────────────────
        // Redefining a key overwrites, so an agent can revise a description or
        // attach an icon to an item it defined earlier in the chat.
        defineItem: (opts: { key: string; label: string; description?: string; icon?: string }) => {
            ctx.itemDefs ??= {};
            const existed = ctx.itemDefs[opts.key] !== undefined;
            ctx.itemDefs[opts.key] = {
                key: opts.key,
                label: opts.label,
                ...(opts.description ? { description: opts.description } : {}),
                ...(opts.icon ? { icon: opts.icon } : {}),
            };
            arr.push(`${existed ? 'Redefined' : 'Defined'} item ${opts.key} (${opts.label})`);
        },

        // ── Inventory (party-wide) ────────────────────────────────────────
        // `name` is the definition key for content written since define_item
        // existed; older chats pass a free-text display name. Effect text uses
        // the definition's label when one is known so the agent reads prose,
        // not identifiers.
        giveItem: (name: string, qty: number = 1) => {
            ctx.inventory[name] = (ctx.inventory[name] ?? 0) + qty;
            arr.push(`Received ${qty}x ${ctx.itemDefs?.[name]?.label ?? name}`);
        },
        takeItem: (name: string, qty: number = 1) => {
            const current = ctx.inventory[name] ?? 0;
            const taken = Math.min(current, qty);
            ctx.inventory[name] = current - taken;
            if (taken > 0) arr.push(`Lost ${taken}x ${ctx.itemDefs?.[name]?.label ?? name}`);
        },
        // Replay must be total, so like takeItem this silently caps at the
        // available quantity — the hard validation (missing item, short qty,
        // absent target) lives in the use_item command's `validate`, which
        // rejects at exec time before a block ever persists.
        useItem: (item: string, target: string, qty: number = 1) => {
            const current = ctx.inventory[item] ?? 0;
            const used = Math.min(current, qty);
            ctx.inventory[item] = current - used;
            if (used > 0) arr.push(`Used ${used}x ${ctx.itemDefs?.[item]?.label ?? item} on ${target}`);
        },

        // ── Scene management ──────────────────────────────────────────────
        enterActors: (customIds: string[]) => {
            for (const id of customIds) {
                if (ensureActive(ctx, id)) arr.push(`${id} entered the scene`);
            }
        },
        leaveActors: (customIds: string[]) => {
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

        // ── Flags + location ─────────────────────────────────────────────
        setFlag: (key: string, value: string | number | boolean) => {
            const prev = ctx.flags[key];
            ctx.flags[key] = value;
            if (prev === undefined) arr.push(`Flag set: ${key} = ${JSON.stringify(value)}`);
            else if (prev !== value) arr.push(`Flag updated: ${key} = ${JSON.stringify(value)} (was ${JSON.stringify(prev)})`);
        },
        clearFlag: (key: string) => {
            if (ctx.flags[key] !== undefined) {
                delete ctx.flags[key];
                arr.push(`Flag cleared: ${key}`);
            }
        },
        setLocation: (description: string) => {
            const prev = ctx.scene.location;
            ctx.scene.location = description;
            if (prev !== description) arr.push(`Scene location: ${description}`);
        },
    } as const;
}

/**
 * Apply a single parsed Block's effect to a context. Used by the client during
 * progressive playback of an assistant turn: the cursor advances block-by-block
 * and each step calls this to keep `effectiveGameState` in sync without going
 * back through `new Function(...)` evaluation. Display-only blocks are no-ops.
 *
 * Implementation routes through `createScope` so the per-command logic stays
 * declared in exactly one place.
 */
export function applyBlockToCtx(ctx: GameStateContext, block: Block, arr: string[]): void {
    const scope = createScope({ ctx, arr });
    switch (block.type) {
        case 'speech':
            // Only the predefined form (with actorId) ensures the actor is active.
            if (block.actorId) scope.speech(block.actorId, block.dialogue);
            return;
        case 'enterActors':
            scope.enterActors(block.actors);
            return;
        case 'leaveActors':
            scope.leaveActors(block.actors);
            return;
        case 'setHp':
            scope.setHp(block.actorId, block.value);
            return;
        case 'damage':
            scope.damage(block.actorId, block.amount);
            return;
        case 'heal':
            scope.heal(block.actorId, block.amount);
            return;
        case 'defineItem':
            scope.defineItem(block);
            return;
        case 'giveItem':
            scope.giveItem(block.name, block.qty);
            return;
        case 'takeItem':
            scope.takeItem(block.name, block.qty);
            return;
        case 'useItem':
            scope.useItem(block.item, block.target, block.qty);
            return;
        case 'setFlag':
            scope.setFlag(block.key, block.value);
            return;
        case 'clearFlag':
            scope.clearFlag(block.key);
            return;
        case 'setLocation':
            scope.setLocation(block.description);
            return;
        // text / pause / image / webview / unformatted / noOpContinue / tryUse: display-only.
    }
}
