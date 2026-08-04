import { z } from 'zod'

/**
 * Tools for the Scenario collaborator — the agent that helps you *author* a
 * Scenario, as opposed to the roleplaying agent that plays one.
 *
 * Deliberately a separate registry from game-state COMMANDS/QUERIES:
 *
 *  - The roleplaying agent narrates. Its writes become blocks in a message log
 *    and it can never touch a character definition (verified: no command in
 *    that registry writes to the actors table).
 *  - The collaborator authors. Its writes are direct CRUD on actors and notes,
 *    and it produces no messages or game state at all.
 *
 * Everything here is scoped to one Scenario. `deps` is built per call from that
 * Scenario's attachments, so an empty Scenario genuinely returns nothing —
 * scoping is a property of the data handed in, not of filtering inside a tool
 * that someone might forget to write.
 */

export type ScenarioAgentDeps = {
    /** The Scenario being edited. */
    chatId: string
    listCharacters: () => Array<{ id: string; name: string; description: string; group?: string }>
    getCharacter: (id: string) => { id: string; name: string; description: string; group?: string; expressions: string[] } | null
    createCharacter: (input: { name: string; description?: string; group?: string }) => Promise<{ id: string; name: string }>
    updateCharacter: (input: { id: string; name?: string; description?: string; group?: string }) => Promise<{ id: string; name: string }>
    removeCharacter: (id: string) => Promise<void>

    listNotes: () => Array<{ id: string; title: string; type: string }>
    getNote: (id: string) => { id: string; title: string; type: string; content: string } | null
    createNote: (input: { title: string; type?: string; content?: string }) => Promise<{ id: string; title: string }>
    updateNote: (input: { id: string; title?: string; type?: string; content?: string }) => Promise<{ id: string; title: string }>
    removeNote: (id: string) => Promise<void>

    /** The global library, for importing something that already exists. */
    searchLibrary: (query: string) => Array<{ id: string; kind: 'character' | 'note'; name: string }>
    importFromLibrary: (id: string) => Promise<{ name: string }>

    /**
     * Fetch a web page. Only Anthropic configs have a real implementation (the
     * Claude SDK ships WebFetch); every other provider returns an explanatory
     * refusal. The tool is still *registered* everywhere on purpose — a model
     * that can't see the tool tends to claim it browsed the page anyway,
     * whereas one that gets a clear "unavailable" says so to the user.
     */
    fetchUrl: (url: string) => Promise<string>
}

export type ScenarioToolSpec<S extends z.ZodTypeAny = z.ZodTypeAny> = {
    name: string
    description: string
    schema: S
    /** Text the model sees as the tool result. */
    run: (args: z.infer<S>, deps: ScenarioAgentDeps) => Promise<string> | string
    /** Marks tools that change or remove data, for the SDK's destructive hint. */
    destructive?: boolean
}

function defineTool<S extends z.ZodTypeAny>(spec: ScenarioToolSpec<S>): ScenarioToolSpec<S> {
    return spec
}

const asList = (rows: Array<Record<string, unknown>>, empty: string) =>
    rows.length === 0 ? empty : rows.map(r => JSON.stringify(r)).join('\n')

export const SCENARIO_TOOLS = {
    list_characters: defineTool({
        name: 'list_characters',
        description: 'List the characters currently in this scenario. Returns nothing if the scenario has no cast yet.',
        schema: z.object({}),
        run: (_args, deps) =>
            asList(deps.listCharacters(), 'This scenario has no characters yet.'),
    }),

    get_character: defineTool({
        name: 'get_character',
        description: 'Read one character in this scenario in full, including its description and available expressions.',
        schema: z.object({ id: z.string().describe('Character id from list_characters') }),
        run: ({ id }, deps) => {
            const found = deps.getCharacter(id)
            return found ? JSON.stringify(found) : `No character ${id} in this scenario.`
        },
    }),

    create_character: defineTool({
        name: 'create_character',
        description: 'Create a character that belongs to this scenario. It is added to the cast and does not appear in the user\'s global character library.',
        schema: z.object({
            name: z.string().describe('Display name'),
            description: z.string().optional().describe('Who they are, in prose — personality, history, how they speak'),
            group: z.string().optional().describe('Optional grouping label, e.g. "party" or "villains"'),
        }),
        run: async (args, deps) => {
            const created = await deps.createCharacter(args)
            return `Created "${created.name}" (id ${created.id}) in this scenario.`
        },
    }),

    update_character: defineTool({
        name: 'update_character',
        description: 'Change a character in this scenario. Only the fields you pass are modified.',
        schema: z.object({
            id: z.string(),
            name: z.string().optional(),
            description: z.string().optional(),
            group: z.string().optional(),
        }),
        destructive: true,
        run: async (args, deps) => {
            const updated = await deps.updateCharacter(args)
            return `Updated "${updated.name}".`
        },
    }),

    remove_character: defineTool({
        name: 'remove_character',
        description: 'Remove a character from this scenario. Characters imported from the library are only detached, never deleted.',
        schema: z.object({ id: z.string() }),
        destructive: true,
        run: async ({ id }, deps) => {
            await deps.removeCharacter(id)
            return `Removed ${id} from this scenario.`
        },
    }),

    list_notes: defineTool({
        name: 'list_notes',
        description: 'List the notes attached to this scenario. Returns nothing if there are none.',
        schema: z.object({}),
        run: (_args, deps) => asList(deps.listNotes(), 'This scenario has no notes yet.'),
    }),

    get_note: defineTool({
        name: 'get_note',
        description: 'Read the full content of one note in this scenario.',
        schema: z.object({ id: z.string() }),
        run: ({ id }, deps) => {
            const found = deps.getNote(id)
            return found ? JSON.stringify(found) : `No note ${id} in this scenario.`
        },
    }),

    create_note: defineTool({
        name: 'create_note',
        description: 'Create a note belonging to this scenario — lore, rules, a premise. It does not appear in the user\'s global note library.',
        schema: z.object({
            title: z.string(),
            type: z.string().optional().describe('Free-form category, e.g. "lore" or "rules"'),
            content: z.string().optional(),
        }),
        run: async (args, deps) => {
            const created = await deps.createNote(args)
            return `Created note "${created.title}" (id ${created.id}) in this scenario.`
        },
    }),

    update_note: defineTool({
        name: 'update_note',
        description: 'Change a note in this scenario. Only the fields you pass are modified.',
        schema: z.object({
            id: z.string(),
            title: z.string().optional(),
            type: z.string().optional(),
            content: z.string().optional(),
        }),
        destructive: true,
        run: async (args, deps) => {
            const updated = await deps.updateNote(args)
            return `Updated note "${updated.title}".`
        },
    }),

    remove_note: defineTool({
        name: 'remove_note',
        description: 'Remove a note from this scenario. Notes imported from the library are only detached, never deleted.',
        schema: z.object({ id: z.string() }),
        destructive: true,
        run: async ({ id }, deps) => {
            await deps.removeNote(id)
            return `Removed note ${id} from this scenario.`
        },
    }),

    search_library: defineTool({
        name: 'search_library',
        description: 'Search the user\'s global library of characters and notes — things that exist outside this scenario and could be imported into it.',
        schema: z.object({ query: z.string().describe('Free text; matches names, titles and descriptions') }),
        run: ({ query }, deps) =>
            asList(deps.searchLibrary(query), `Nothing in the library matches "${query}".`),
    }),

    fetch_url: defineTool({
        name: 'fetch_url',
        description: 'Fetch and read a web page, for pulling reference material into a character or note. May be unavailable depending on the configured model.',
        schema: z.object({ url: z.string().describe('Absolute http(s) URL') }),
        run: async ({ url }, deps) => deps.fetchUrl(url),
    }),

    import_from_library: defineTool({
        name: 'import_from_library',
        description: 'Add an existing library character or note to this scenario. It is linked, not copied — edits are shared with anywhere else it is used.',
        schema: z.object({ id: z.string().describe('Id from search_library') }),
        run: async ({ id }, deps) => {
            const imported = await deps.importFromLibrary(id)
            return `Imported "${imported.name}" into this scenario.`
        },
    }),
} as const

export type ScenarioToolName = keyof typeof SCENARIO_TOOLS

export const SCENARIO_AGENT_PROMPT = `You are helping the user shape a *scenario* — a reusable, ready-to-play setup for a roleplaying session: its cast, its notes, its premise.

You are not running the roleplay. You do not narrate, speak as characters, or advance a story. You edit the scenario's building blocks and talk to the user about them.

Everything you can see is scoped to this one scenario. If your tools return nothing, the scenario is genuinely empty — do not assume characters exist elsewhere and do not invent them.

Characters and notes you create belong to this scenario and stay out of the user's global library. Use search_library and import_from_library when the user wants something they have already written.

Prefer small, concrete steps. Confirm before removing or overwriting anything the user did not explicitly ask you to change.`
