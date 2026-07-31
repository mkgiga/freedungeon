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
    /**
     * Actor profiles for actors referenced by this chat (or all known actors).
     *
     * NOTE: the `id` field here is the agent-facing identifier — it's
     * backed by the DB's `Actor.customId` column (user-authored, stable,
     * friendly). The Actor type also has a separate `id` nanoid primary
     * key that the agent NEVER sees. The aliasing happens in
     * server/src/agent.ts handleQuery. Keeping that internal name out of
     * the agent's vocabulary avoids two things being called "id" at the
     * same layer.
     */
    actors: Array<{
        id: string;
        name: string;
        description: string;
        expressions: string[];
        group?: string;
    }>;
    /** Notes attached to this chat (enabled ones only — disabled notes excluded). */
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

function findActor(deps: QueryDeps, id: string) {
    return deps.actors.find(a => a.id === id);
}

export const QUERIES = {
    get_actor_hp: defineQuery({
        name: 'get_actor_hp',
        description: 'Return current HP for an actor by id. Result mentions whether they\'re active, offscreen, or unknown.',
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
        description: 'List actors preloaded into this chat (regardless of scene presence). Returns id, name, and a short description for each — use this to discover ids for speech/enter_actors/damage.',
        schema: z.object({}),
        run: (_args, deps) => {
            if (deps.actors.length === 0) return '(no actors preloaded in this chat)';
            return deps.actors.map(a => {
                const exprs = a.expressions.length > 0 ? ` [expressions: ${a.expressions.join(', ')}]` : '';
                return `${a.id} — ${a.name}${exprs}\n  ${a.description.slice(0, 200)}`;
            }).join('\n\n');
        },
    }),

    get_actor: defineQuery({
        name: 'get_actor',
        description: 'Return full profile for a single actor by id — name, description, available expressions.',
        schema: z.object({ actorId: z.string() }),
        run: (args, deps) => {
            const a = findActor(deps, args.actorId);
            if (!a) return `Actor "${args.actorId}" not found in this chat.`;
            const exprs = a.expressions.length > 0 ? a.expressions.join(', ') : '(none)';
            return `id: ${a.id}\nname: ${a.name}\nexpressions: ${exprs}\n\n${a.description}`;
        },
    }),

    list_inventory: defineQuery({
        name: 'list_inventory',
        description: 'List all party inventory items with their quantities, as `key (Label)`. Pass the key to give_item/take_item/use_item.',
        schema: z.object({}),
        run: (_args, deps) => {
            const entries = Object.entries(deps.ctx.inventory).filter(([, qty]) => qty > 0);
            if (entries.length === 0) return '(inventory empty)';
            return entries.map(([key, qty]) => {
                const def = deps.ctx.itemDefs?.[key];
                return def ? `${qty}x ${key} (${def.label})` : `${qty}x ${key}`;
            }).join('\n');
        },
    }),

    list_item_definitions: defineQuery({
        name: 'list_item_definitions',
        description: 'List every item type defined in this chat, whether or not the party currently holds any. Check here before calling define_item so an existing item is reused rather than redefined under a new key.',
        schema: z.object({}),
        run: (_args, deps) => {
            const defs = Object.values(deps.ctx.itemDefs ?? {});
            if (defs.length === 0) return '(no items defined)';
            return defs.map(d => `${d.key} (${d.label})${d.description ? ` — ${d.description}` : ''}`).join('\n');
        },
    }),

    get_inventory_item: defineQuery({
        name: 'get_inventory_item',
        description: 'Return current quantity of a single inventory item by its exact definition key. Returns 0 if absent.',
        schema: z.object({ name: z.string().describe('Item definition key.') }),
        run: (args, deps) => {
            const qty = deps.ctx.inventory[args.name] ?? 0;
            const def = deps.ctx.itemDefs?.[args.name];
            return `${args.name}${def ? ` (${def.label})` : ''}: ${qty}`;
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
