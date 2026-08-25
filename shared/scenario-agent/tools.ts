import { z } from 'zod'

/**
 * Tools for the Scenario collaborator - the agent that authors a Scenario,
 * not the roleplaying agent that plays one.
 *
 * A separate registry from game-state COMMANDS/QUERIES: that agent writes
 * blocks into a message log and can never touch an actor definition; this one
 * does direct CRUD and produces no messages. `deps` is built per call from one
 * Scenario's attachments, so scoping comes from the data, not per-tool filters.
 */

export type ScenarioAgentDeps = {
    chatId: string
    listCharacters: () => Array<{ id: string; name: string; description: string }>
    getCharacter: (id: string) => { id: string; name: string; description: string; expressions: string[] } | null
    createCharacter: (input: { name: string; description?: string }) => Promise<{ id: string; name: string }>
    updateCharacter: (input: { id: string; name?: string; description?: string }) => Promise<{ id: string; name: string }>
    removeCharacter: (id: string) => Promise<void>

    listNotes: () => Array<{ id: string; title: string; type: string }>
    getNote: (id: string) => { id: string; title: string; type: string; content: string } | null
    createNote: (input: { title: string; type?: string; content?: string }) => Promise<{ id: string; title: string }>
    updateNote: (input: { id: string; title?: string; type?: string; content?: string }) => Promise<{ id: string; title: string }>
    removeNote: (id: string) => Promise<void>

    searchLibrary: (query: string) => Array<{ id: string; kind: 'character' | 'note'; name: string }>
    importFromLibrary: (id: string) => Promise<{ name: string }>

    fetchUrl: (url: string) => Promise<string>
}

export type ScenarioToolSpec<S extends z.ZodTypeAny = z.ZodTypeAny> = {
    name: string
    description: string
    schema: S
    run: (args: z.infer<S>, deps: ScenarioAgentDeps) => Promise<string> | string
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
            type: z.string().optional().describe('Free-form category'),
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

