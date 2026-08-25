import { z } from 'zod';
import type { Block } from '../blocks';
import type { GameStateContext } from '../types';

/**
 * An MCP tool that produces exactly one Block when the agent calls it. The
 * Block is the unit of persistence (one Block ↔ one ChatMessage), state
 * mutation (applyBlockToCtx during replay), and display.
 *
 * The MCP server and the RPC handler both read this registry, so they can't
 * disagree on the arg shape.
 */
export type CommandSpec<S extends z.ZodTypeAny = z.ZodTypeAny> = {
    name: string;
    description: string;
    schema: S;
    toBlock: (args: z.infer<S>) => Block;
    validate?: (args: z.infer<S>, ctx: GameStateContext) => string | null;
    destructive?: boolean;
};

function defineCommand<S extends z.ZodTypeAny>(spec: CommandSpec<S>): CommandSpec<S> {
    return spec;
}

const speechSchema = z.object({
    actorId: z.string().optional().describe('Id of a predefined actor (via list_chat_actors), or a made-up id for a new recurring speaker. Omit for a one-off unnamed speaker and pass `name`.'),
    name: z.string().optional().describe('Display name. Required when actorId is omitted (ad-hoc speaker); optional override when actorId is set.'),
    dialogue: z.string().describe('The line of dialogue, present tense.'),
    expression: z.string().optional().describe('Expression name. Must exactly match one of the actor\'s defined expressions.'),
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
        description: 'Dialogue from an actor. Pass an `actorId` — a predefined one from list_chat_actors, or a made-up one for a new recurring speaker; either is added to the active scene if absent. Pass only a `name` for a one-off speaker, who is not tracked.',
        schema: speechSchema,
        toBlock: (args) => args.actorId
            ? {
                type: 'speech',
                actorId: args.actorId,
                dialogue: args.dialogue,
                ...(args.name ? { name: args.name } : {}),
                ...(args.expression ? { expression: args.expression } : {}),
            }
            : {
                type: 'speech',
                dialogue: args.dialogue,
                name: args.name,
            },
    }),

    pause: defineCommand({
        name: 'pause',
        description: 'Insert a timed pause between blocks (int or float seconds). Use sparingly for dramatic effect.',
        schema: z.object({
            seconds: z.number().min(0).max(10),
        }),
        toBlock: (args) => ({ type: 'pause', seconds: args.seconds }),
    }),

    image: defineCommand({
        name: 'image',
        description: 'Display an image from an actor\'s image gallery. src must be an exact filename from that actor\'s expressions list. Never fabricate filenames.',
        schema: z.object({
            src: z.string().describe('Exact filename from the actor\'s expressions list.'),
            from: z.string().describe('Actor id whose gallery the image belongs to.'),
            caption: z.string().optional(),
        }),
        toBlock: (args) => ({
            type: 'image',
            src: args.src,
            from: args.from,
            ...(args.caption ? { caption: args.caption } : {}),
        }),
    }),

    show_image: defineCommand({
        name: 'show_image',
        description: 'Display one of this chat\'s attached images inline in the story. `key` must be one listed by list_images — never invent one.',
        schema: z.object({
            key: z.string().describe('Image key from list_images.'),
            caption: z.string().optional().describe('Optional text shown under the image.'),
        }),
        toBlock: (args) => ({
            type: 'image',
            src: '',
            from: 'library',
            ...(args.caption ? { caption: args.caption } : {}),
        }),
    }),

    generate_image: defineCommand({
        name: 'generate_image',
        description: 'Generate and display an image inline in the story, for visual exposition prose would not carry. One image per beat at most; this blocks the turn while it renders.',
        schema: z.object({
            description: z.string().describe('The image to generate, for an image model. Concrete visual nouns, not story context — it has no idea who these characters are.'),
            aspect: z.enum(['square', 'landscape', 'portrait']).describe('Shape of the image. "landscape" for establishing shots and vistas, "portrait" for a figure or a tall space, "square" when neither dominates.'),
            caption: z.string().optional().describe('Optional text shown under the image.'),
        }),
        toBlock: (args) => ({
            type: 'image',
            src: '',
            from: 'generated',
            aspect: args.aspect,
            ...(args.caption ? { caption: args.caption } : {}),
        }),
    }),

    webview: defineCommand({
        name: 'webview',
        description: 'Render a sandboxed HTML iframe inline. Use for diagrams, notes, mini-UIs.',
        schema: z.object({
            html: z.string(),
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
            ids: z.array(z.string()).min(1).describe('Actor ids to add to the scene.'),
        }),
        toBlock: (args) => ({ type: 'enterActors', actors: args.ids }),
    }),

    leave_actors: defineCommand({
        name: 'leave_actors',
        description: 'Move one or more actors from active to offscreen, preserving HP for later reintroduction.',
        schema: z.object({
            ids: z.array(z.string()).min(1).describe('Actor ids to remove from the active scene.'),
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

    define_item: defineCommand({
        name: 'define_item',
        description: 'Define an item type before it can be given to the party. Calling this again with the same key updates the definition.',
        schema: z.object({
            key: z.string().regex(/^[a-z][a-z0-9_]*$/, 'Use snake_case (lowercase + underscores).').describe('Stable snake_case identifier. Referenced by give_item.'),
            label: z.string().describe('Player-facing display name.'),
            description: z.string().describe('Short blurb shown to the player on the item card, in the voice of the story.'),
            visualDescription: z.string().describe('How the item looks, for an image model — the object alone, no background, no story context. Never shown to the player.'),
        }),
        toBlock: (args) => ({
            type: 'defineItem',
            key: args.key,
            label: args.label,
            description: args.description,
            visualDescription: args.visualDescription,
        }),
    }),

    give_item: defineCommand({
        name: 'give_item',
        description: 'Add a defined item to the party inventory. `key` must reference an item previously created with define_item. Inventory is shared, not per-actor.',
        schema: z.object({
            key: z.string().describe('The item definition key, exactly as passed to define_item.'),
            qty: z.number().int().positive().default(1),
        }),
        toBlock: (args) => ({ type: 'giveItem', name: args.key, qty: args.qty }),
        validate: (args, ctx) => {
            if (ctx.itemDefs?.[args.key]) return null;
            const known = Object.keys(ctx.itemDefs ?? {});
            return `no item defined with key "${args.key}". Call define_item first. Defined keys: ${known.length ? known.join(', ') : '(none)'}`;
        },
    }),

    take_item: defineCommand({
        name: 'take_item',
        description: 'Remove up to qty of an item from the party inventory. Silently caps at the current quantity.',
        schema: z.object({
            name: z.string().describe('Item definition key, exactly as listed in the inventory.'),
            qty: z.number().int().positive().default(1),
        }),
        toBlock: (args) => ({ type: 'takeItem', name: args.name, qty: args.qty }),
    }),

    use_item: defineCommand({
        name: 'use_item',
        description: 'Consume item(s) from the party inventory, used on a target actor. Call this to resolve a tryUse(...) attempt from the user. Errors without side effects if the item is missing, the quantity falls short, or the target is not in the active scene — on error, narrate the failure instead. On success only the consumption is recorded; apply what the item actually does via follow-up tools and narrate the outcome.',
        schema: z.object({
            item: z.string().describe('Item definition key, exactly as listed in the inventory.'),
            target: z.string().describe('Id of the actor the item is used on.'),
            qty: z.number().int().positive().default(1),
        }),
        toBlock: (args) => ({ type: 'useItem', item: args.item, target: args.target, qty: args.qty }),
        validate: (args, ctx) => {
            const have = ctx.inventory[args.item] ?? 0;
            if (have <= 0) {
                const names = Object.entries(ctx.inventory)
                    .filter(([, qty]) => qty > 0)
                    .map(([key]) => ctx.itemDefs?.[key] ? `${key} (${ctx.itemDefs[key]!.label})` : key);
                return `no "${args.item}" in inventory. Current inventory: ${names.length ? names.join(', ') : '(empty)'}`;
            }
            if (have < args.qty) {
                return `not enough "${args.item}": have ${have}, tried to use ${args.qty}`;
            }
            if (!ctx.scene.actors.active[args.target]) {
                return `target actor "${args.target}" is not in the active scene`;
            }
            return null;
        },
    }),

    set_flag: defineCommand({
        name: 'set_flag',
        description: 'Set a named flag in the scratchpad — anything not modelled by HP, inventory or actors. Value can be string, number, or boolean.',
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
            description: z.string().describe('Short phrase naming where the focus actor is.'),
        }),
        toBlock: (args) => ({ type: 'setLocation', description: args.description }),
        destructive: true,
    }),

    choice_prompt: defineCommand({
        name: 'choice_prompt',
        description: 'Internal: persists the multiple-choice menu offered via end_turn\'s `choices` arg. Not a standalone tool.',
        schema: z.object({
            options: z.array(z.string()).min(2).describe('2+ short, present-tense action options for the user to choose from.'),
        }),
        toBlock: (args) => ({ type: 'choicePrompt', options: args.options }),
    }),
} as const;

export type CommandName = keyof typeof COMMANDS;

/** Optional features that change what a command accepts. */
export type CommandFeatures = { itemIcons?: boolean };

/**
 * The arg schema to expose for a command, given which features are on.
 *
 * `visualDescription` is the prompt handed to the image model, so with icon
 * generation off it asks for a paragraph per item that nothing renders. Lives
 * here so the MCP server and the AI-SDK loop can't disagree.
 */
export function commandSchema(key: CommandName, features: CommandFeatures): z.ZodTypeAny {
    if (key === 'define_item' && !features.itemIcons) {
        return COMMANDS.define_item.schema.omit({ visualDescription: true });
    }
    return COMMANDS[key].schema;
}
