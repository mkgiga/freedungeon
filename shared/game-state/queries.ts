import { z } from 'zod';
import type { GameStateContext } from '../types';

/**
 * Read-only MCP tools the agent can call to inspect current state without
 * mutating it. These are pure reads against the server's authoritative state
 * and never produce a ChatMessage. The model uses them to verify before
 * acting ("is vega still alive before I damage them?") or to disambiguate
 * actor ids before calling speech/damage/etc.
 */
export type QueryDeps = {
    ctx: GameStateContext;
    /** Actor profiles for actors referenced by this chat (or all known actors). */
    actors: Array<{
        customId: string;
        name: string;
        description: string;
        expressions: string[];
        group?: string;
    }>;
    /** Notes attached to this chat (enabled ones only — hotbar-disabled excluded). */
    notes: Array<{
        title: string;
        type: string;
        content: string;
    }>;
};

export type QuerySpec<S extends z.ZodTypeAny = z.ZodTypeAny> = {
    name: string;
    description: string;
    schema: S;
    /** Returns the textual result the agent sees as tool_result. */
    run: (args: z.infer<S>, deps: QueryDeps) => string;
};

function defineQuery<S extends z.ZodTypeAny>(spec: QuerySpec<S>): QuerySpec<S> {
    return spec;
}

function findActor(deps: QueryDeps, customId: string) {
    return deps.actors.find(a => a.customId === customId);
}

export const QUERIES = {
    get_actor_hp: defineQuery({
        name: 'get_actor_hp',
        description: 'Return current HP for an actor by custom id. Result mentions whether they\'re active, offscreen, or unknown.',
        schema: z.object({ actorId: z.string() }),
        run: (args, deps) => {
            const active = deps.ctx.scene.actors.active[args.actorId];
            if (active) return `${args.actorId}: HP ${active.hp} (active in scene)`;
            const offscreen = deps.ctx.scene.actors.offscreen[args.actorId];
            if (offscreen) return `${args.actorId}: HP ${offscreen.hp} (offscreen)`;
            return `${args.actorId}: not tracked (never entered the scene this chat)`;
        },
    }),

    list_active_actors: defineQuery({
        name: 'list_active_actors',
        description: 'List actors currently in the active scene with their HP. Use before speech/damage to verify presence.',
        schema: z.object({}),
        run: (_args, deps) => {
            const entries = Object.entries(deps.ctx.scene.actors.active);
            if (entries.length === 0) return '(no actors in active scene)';
            return entries.map(([id, s]) => `${id}: HP ${s.hp}`).join('\n');
        },
    }),

    list_offscreen_actors: defineQuery({
        name: 'list_offscreen_actors',
        description: 'List actors that have left the scene but whose HP is remembered for reintroduction.',
        schema: z.object({}),
        run: (_args, deps) => {
            const entries = Object.entries(deps.ctx.scene.actors.offscreen);
            if (entries.length === 0) return '(no offscreen actors)';
            return entries.map(([id, s]) => `${id}: HP ${s.hp}`).join('\n');
        },
    }),

    list_chat_actors: defineQuery({
        name: 'list_chat_actors',
        description: 'List actors preloaded into this chat (regardless of scene presence). Returns custom id, name, and a short description for each — use this to discover ids for speech/enter_actors/damage.',
        schema: z.object({}),
        run: (_args, deps) => {
            if (deps.actors.length === 0) return '(no actors preloaded in this chat)';
            return deps.actors.map(a => {
                const exprs = a.expressions.length > 0 ? ` [expressions: ${a.expressions.join(', ')}]` : '';
                return `${a.customId} — ${a.name}${exprs}\n  ${a.description.slice(0, 200)}`;
            }).join('\n\n');
        },
    }),

    get_actor: defineQuery({
        name: 'get_actor',
        description: 'Return full profile for a single actor by custom id — name, description, available expressions.',
        schema: z.object({ actorId: z.string() }),
        run: (args, deps) => {
            const a = findActor(deps, args.actorId);
            if (!a) return `Actor "${args.actorId}" not found in this chat.`;
            const exprs = a.expressions.length > 0 ? a.expressions.join(', ') : '(none)';
            return `customId: ${a.customId}\nname: ${a.name}\nexpressions: ${exprs}\n\n${a.description}`;
        },
    }),

    list_inventory: defineQuery({
        name: 'list_inventory',
        description: 'List all party inventory items with their quantities.',
        schema: z.object({}),
        run: (_args, deps) => {
            const entries = Object.entries(deps.ctx.inventory).filter(([, qty]) => qty > 0);
            if (entries.length === 0) return '(inventory empty)';
            return entries.map(([name, qty]) => `${qty}x ${name}`).join('\n');
        },
    }),

    get_inventory_item: defineQuery({
        name: 'get_inventory_item',
        description: 'Return current quantity of a single inventory item by exact name. Returns 0 if absent.',
        schema: z.object({ name: z.string() }),
        run: (args, deps) => {
            const qty = deps.ctx.inventory[args.name] ?? 0;
            return `${args.name}: ${qty}`;
        },
    }),

    get_flag: defineQuery({
        name: 'get_flag',
        description: 'Read a scratchpad flag by key. Returns "(unset)" if the flag doesn\'t exist.',
        schema: z.object({ key: z.string() }),
        run: (args, deps) => {
            const v = deps.ctx.flags[args.key];
            if (v === undefined) return `${args.key}: (unset)`;
            return `${args.key}: ${JSON.stringify(v)}`;
        },
    }),

    list_flags: defineQuery({
        name: 'list_flags',
        description: 'List every set flag with its value.',
        schema: z.object({}),
        run: (_args, deps) => {
            const entries = Object.entries(deps.ctx.flags);
            if (entries.length === 0) return '(no flags set)';
            return entries.map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join('\n');
        },
    }),

    get_location: defineQuery({
        name: 'get_location',
        description: 'Return the current scene location description, if set.',
        schema: z.object({}),
        run: (_args, deps) => {
            return deps.ctx.scene.location ?? '(no location set)';
        },
    }),

    list_notes: defineQuery({
        name: 'list_notes',
        description: 'List enabled notes attached to this chat. Each note has a title, optional type, and content body.',
        schema: z.object({}),
        run: (_args, deps) => {
            if (deps.notes.length === 0) return '(no notes attached to this chat)';
            return deps.notes.map(n => `### ${n.title}${n.type ? ` (${n.type})` : ''}\n${n.content}`).join('\n\n');
        },
    }),

    get_full_state: defineQuery({
        name: 'get_full_state',
        description: 'Dump the entire game state context as JSON. Use sparingly — prefer narrower queries.',
        schema: z.object({}),
        run: (_args, deps) => JSON.stringify(deps.ctx, null, 2),
    }),
} as const;

export type QueryName = keyof typeof QUERIES;
