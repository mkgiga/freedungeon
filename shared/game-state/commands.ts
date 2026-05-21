import { z } from 'zod';
import type { Block } from '../blocks';

/**
 * A command spec defines an MCP tool that, when invoked by the agent, produces
 * exactly one Block. The Block is the unit of:
 *   - persistence (one Block ↔ one ChatMessage, serialized via serializeBlocks)
 *   - state mutation (via applyBlockToCtx during replay)
 *   - display (rendered by the matching client component)
 *
 * The registry is the single source of truth that the agent's MCP server and
 * the server's RPC handler both read from — they cannot disagree on the
 * arg shape because there is only one schema.
 */
export type CommandSpec<S extends z.ZodTypeAny = z.ZodTypeAny> = {
    name: string;
    description: string;
    schema: S;
    /**
     * Build the Block this command emits. Pure — the server applies the
     * returned Block via applyBlockToCtx to derive the resulting state
     * change. Authors must not access external state here.
     */
    toBlock: (args: z.infer<S>) => Block;
    /**
     * MCP tool annotations forwarded to the model. `readOnlyHint: false` is
     * implicit (commands mutate); we explicitly mark `destructiveHint` for
     * commands that overwrite prior state without an inverse.
     */
    destructive?: boolean;
};

function defineCommand<S extends z.ZodTypeAny>(spec: CommandSpec<S>): CommandSpec<S> {
    return spec;
}

const speechPredefinedSchema = z.object({
    actorId: z.string().describe('Custom id of a predefined actor in the chat. Use list_active_actors / list_chat_actors to discover ids.'),
    dialogue: z.string().describe('The line of dialogue, present tense.'),
    name: z.string().optional().describe('Override display name. Rarely needed when actorId is set.'),
    expression: z.string().optional().describe('Expression name. Must exactly match one of the actor\'s defined expressions.'),
});

const speechAdHocSchema = z.object({
    name: z.string().describe('Display name for the ad-hoc actor (no actorId).'),
    dialogue: z.string().describe('The line of dialogue, present tense.'),
});

export const COMMANDS = {
    text: defineCommand({
        name: 'text',
        description: 'Emit a single narration beat (present tense, observable). Keep each call atomic — prefer many short text() calls over one long block.',
        schema: z.object({
            content: z.string().describe('Narration text. Supports inline actor mentions like <@actor_id>.'),
        }),
        toBlock: (args) => ({ type: 'text', content: args.content }),
    }),

    speech: defineCommand({
        name: 'speech',
        description: 'Dialogue from a predefined actor. Use the actor\'s custom id (not their numeric id). Auto-adds the actor to the active scene if absent.',
        schema: speechPredefinedSchema,
        toBlock: (args) => ({
            type: 'speech',
            actorId: args.actorId,
            dialogue: args.dialogue,
            ...(args.name ? { name: args.name } : {}),
            ...(args.expression ? { expression: args.expression } : {}),
        }),
    }),

    speech_adhoc: defineCommand({
        name: 'speech_adhoc',
        description: 'Dialogue from an ad-hoc unnamed actor (e.g., a guard, a passerby). Use this when the speaker is not one of the predefined actors and doesn\'t need to persist.',
        schema: speechAdHocSchema,
        toBlock: (args) => ({
            type: 'speech',
            dialogue: args.dialogue,
            name: args.name,
        }),
    }),

    pause: defineCommand({
        name: 'pause',
        description: 'Insert a timed pause between blocks (int or float seconds). Use sparingly for dramatic effect.',
        schema: z.object({
            seconds: z.number().min(0).max(10).describe('Pause length in seconds.'),
        }),
        toBlock: (args) => ({ type: 'pause', seconds: args.seconds }),
    }),

    image: defineCommand({
        name: 'image',
        description: 'Display an image from an actor\'s image gallery. src must be an exact filename from that actor\'s expressions list. Never fabricate filenames.',
        schema: z.object({
            src: z.string().describe('Exact filename from the actor\'s expressions list.'),
            from: z.string().describe('Actor custom id whose gallery the image belongs to.'),
            caption: z.string().optional(),
        }),
        toBlock: (args) => ({
            type: 'image',
            src: args.src,
            from: args.from,
            ...(args.caption ? { caption: args.caption } : {}),
        }),
    }),

    webview: defineCommand({
        name: 'webview',
        description: 'Render a sandboxed HTML iframe inline. Use for diagrams, notes, mini-UIs.',
        schema: z.object({
            html: z.string().describe('HTML body fragment.'),
            css: z.string().optional(),
            script: z.string().optional(),
        }),
        toBlock: (args) => ({
            type: 'webview',
            html: args.html,
            ...(args.css ? { css: args.css } : {}),
            ...(args.script ? { script: args.script } : {}),
        }),
    }),

    enter_actors: defineCommand({
        name: 'enter_actors',
        description: 'Move one or more actors into the active scene. Restores HP from offscreen if they were there, otherwise starts at HP 100. No-op if already active.',
        schema: z.object({
            ids: z.array(z.string()).min(1).describe('Actor custom ids to add to the scene.'),
        }),
        toBlock: (args) => ({ type: 'enterActors', actors: args.ids }),
    }),

    leave_actors: defineCommand({
        name: 'leave_actors',
        description: 'Move one or more actors from active to offscreen, preserving HP for later reintroduction.',
        schema: z.object({
            ids: z.array(z.string()).min(1).describe('Actor custom ids to remove from the active scene.'),
        }),
        toBlock: (args) => ({ type: 'leaveActors', actors: args.ids }),
    }),

    set_hp: defineCommand({
        name: 'set_hp',
        description: 'Overwrite an actor\'s HP. Auto-creates the actor in the active scene if not tracked.',
        schema: z.object({
            actorId: z.string(),
            value: z.number().int(),
        }),
        toBlock: (args) => ({ type: 'setHp', actorId: args.actorId, value: args.value }),
        destructive: true,
    }),

    damage: defineCommand({
        name: 'damage',
        description: 'Subtract HP (clamped at 0). No-op if the actor isn\'t tracked.',
        schema: z.object({
            actorId: z.string(),
            amount: z.number().int().positive(),
        }),
        toBlock: (args) => ({ type: 'damage', actorId: args.actorId, amount: args.amount }),
    }),

    heal: defineCommand({
        name: 'heal',
        description: 'Add HP. No-op if the actor isn\'t tracked.',
        schema: z.object({
            actorId: z.string(),
            amount: z.number().int().positive(),
        }),
        toBlock: (args) => ({ type: 'heal', actorId: args.actorId, amount: args.amount }),
    }),

    give_item: defineCommand({
        name: 'give_item',
        description: 'Add an item to the party inventory by name. Inventory is shared, not per-actor.',
        schema: z.object({
            name: z.string(),
            qty: z.number().int().positive().default(1),
        }),
        toBlock: (args) => ({ type: 'giveItem', name: args.name, qty: args.qty }),
    }),

    take_item: defineCommand({
        name: 'take_item',
        description: 'Remove up to qty of an item from the party inventory. Silently caps at the current quantity.',
        schema: z.object({
            name: z.string(),
            qty: z.number().int().positive().default(1),
        }),
        toBlock: (args) => ({ type: 'takeItem', name: args.name, qty: args.qty }),
    }),

    set_flag: defineCommand({
        name: 'set_flag',
        description: 'Set a named flag in the scratchpad. Use for narrative conditions ("dragon_defeated"), chapter markers ("current_chapter"), or anything not modeled by HP/inventory/actors. Value can be string, number, or boolean.',
        schema: z.object({
            key: z.string().regex(/^[a-z][a-z0-9_]*$/, 'Use snake_case (lowercase + underscores).'),
            value: z.union([z.string(), z.number(), z.boolean()]),
        }),
        toBlock: (args) => ({ type: 'setFlag', key: args.key, value: args.value }),
        destructive: true,
    }),

    clear_flag: defineCommand({
        name: 'clear_flag',
        description: 'Remove a flag from the scratchpad.',
        schema: z.object({ key: z.string() }),
        toBlock: (args) => ({ type: 'clearFlag', key: args.key }),
    }),

    set_location: defineCommand({
        name: 'set_location',
        description: 'Update the short description of where the focus actor currently is. Use sparingly — only when the scene actually moves.',
        schema: z.object({
            description: z.string().describe('Short phrase like "the throne room" or "outside the inn".'),
        }),
        toBlock: (args) => ({ type: 'setLocation', description: args.description }),
        destructive: true,
    }),
} as const;

export type CommandName = keyof typeof COMMANDS;
