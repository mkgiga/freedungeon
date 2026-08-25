
import { nanoid } from 'nanoid'
import { SCENARIO_TOOLS, type ScenarioAgentDeps, type ScenarioToolName } from '@shared/scenario-agent/tools'
import { visible, inLibrary } from '@shared/visibility'
import { mutate, state } from './server'
import type { Actor, Note } from '@shared/types'

function scenarioActors(chatId: string): Actor[] {
    const chat = state.assets.chats[chatId]
    if (!chat) return []
    return visible(
        chat.assets.actors
            .map(id => state.assets.actors[id])
            .filter((a): a is Actor => Boolean(a)),
    )
}

function scenarioNotes(chatId: string): Note[] {
    const chat = state.assets.chats[chatId]
    if (!chat) return []
    return visible(
        Object.keys(chat.assets.notes)
            .map(id => state.assets.notes[id])
            .filter((n): n is Note => Boolean(n)),
    )
}

function attachActor(chatId: string, actorId: string) {
    const chat = state.assets.chats[chatId]
    if (!chat || chat.assets.actors.includes(actorId)) return
    mutate(s => { s.assets.chats[chatId] = {
        ...chat,
        assets: { ...chat.assets, actors: [...chat.assets.actors, actorId] },
        updatedAt: Date.now(),
    } })
}

function attachNote(chatId: string, noteId: string) {
    const chat = state.assets.chats[chatId]
    if (!chat || chat.assets.notes[noteId]) return
    mutate(s => { s.assets.chats[chatId] = {
        ...chat,
        assets: { ...chat.assets, notes: { ...chat.assets.notes, [noteId]: { enabled: true } } },
        updatedAt: Date.now(),
    } })
}

function detach(chatId: string, id: string, kind: 'actor' | 'note') {
    const chat = state.assets.chats[chatId]
    if (!chat) return
    const assets = kind === 'actor'
        ? { ...chat.assets, actors: chat.assets.actors.filter(a => a !== id) }
        : { ...chat.assets, notes: Object.fromEntries(Object.entries(chat.assets.notes).filter(([n]) => n !== id)) }
    mutate(s => { s.assets.chats[chatId] = { ...chat, assets, updatedAt: Date.now() } })
}

export function buildScenarioDeps(chatId: string): ScenarioAgentDeps {
    return {
        chatId,

        listCharacters: () => scenarioActors(chatId).map(a => ({
            id: a.id, name: a.name, description: a.description,
        })),

        getCharacter: (id) => {
            const found = scenarioActors(chatId).find(a => a.id === id)
            return found ? {
                id: found.id,
                name: found.name,
                description: found.description,
                expressions: Object.keys(found.expressions ?? {}),
            } : null
        },

        createCharacter: async ({ name, description }) => {
            const id = nanoid()
            const now = Date.now()
            const actor: Actor = {
                id,
                customId: nanoid(12),
                name,
                description: description ?? '',
                avatarUrl: '',
                expressions: {},
                homeChatId: chatId,
                deletedAt: null,
                createdAt: now,
                updatedAt: now,
            }
            mutate(s => { s.assets.actors[id] = actor })
            attachActor(chatId, id)
            return { id, name }
        },

        updateCharacter: async ({ id, ...patch }) => {
            const existing = scenarioActors(chatId).find(a => a.id === id)
            if (!existing) throw new Error(`No character ${id} in this scenario`)
            const next: Actor = {
                ...existing,
                ...(patch.name !== undefined ? { name: patch.name } : {}),
                ...(patch.description !== undefined ? { description: patch.description } : {}),
                updatedAt: Date.now(),
            }
            mutate(s => { s.assets.actors[id] = next })
            return { id, name: next.name }
        },

        removeCharacter: async (id) => {
            const existing = scenarioActors(chatId).find(a => a.id === id)
            if (!existing) throw new Error(`No character ${id} in this scenario`)
            detach(chatId, id, 'actor')
            if (existing.homeChatId === chatId) {
                mutate(s => { s.assets.actors[id] = { ...existing, deletedAt: Date.now() } })
            }
        },

        listNotes: () => scenarioNotes(chatId).map(n => ({ id: n.id, title: n.title, type: n.type })),

        getNote: (id) => {
            const found = scenarioNotes(chatId).find(n => n.id === id)
            return found ? { id: found.id, title: found.title, type: found.type, content: found.content } : null
        },

        createNote: async ({ title, type, content }) => {
            const id = nanoid()
            const now = Date.now()
            const note: Note = {
                id,
                title,
                type: type ?? '',
                content: content ?? '',
                homeChatId: chatId,
                deletedAt: null,
                createdAt: now,
                updatedAt: now,
            }
            mutate(s => { s.assets.notes[id] = note })
            attachNote(chatId, id)
            return { id, title }
        },

        updateNote: async ({ id, ...patch }) => {
            const existing = scenarioNotes(chatId).find(n => n.id === id)
            if (!existing) throw new Error(`No note ${id} in this scenario`)
            const next: Note = {
                ...existing,
                ...(patch.title !== undefined ? { title: patch.title } : {}),
                ...(patch.type !== undefined ? { type: patch.type } : {}),
                ...(patch.content !== undefined ? { content: patch.content } : {}),
                updatedAt: Date.now(),
            }
            mutate(s => { s.assets.notes[id] = next })
            return { id, title: next.title }
        },

        removeNote: async (id) => {
            const existing = scenarioNotes(chatId).find(n => n.id === id)
            if (!existing) throw new Error(`No note ${id} in this scenario`)
            detach(chatId, id, 'note')
            if (existing.homeChatId === chatId) {
                mutate(s => { s.assets.notes[id] = { ...existing, deletedAt: Date.now() } })
            }
        },

        searchLibrary: (query) => {
            const q = query.toLowerCase().trim()
            const match = (...fields: (string | undefined)[]) =>
                !q || fields.some(f => f?.toLowerCase().includes(q))
            const actors = inLibrary(Object.values(state.assets.actors))
                .filter(a => match(a.name, a.description))
                .map(a => ({ id: a.id, kind: 'character' as const, name: a.name }))
            const notes = inLibrary(Object.values(state.assets.notes))
                .filter(n => match(n.title, n.type, n.content))
                .map(n => ({ id: n.id, kind: 'note' as const, name: n.title }))
            return [...actors, ...notes].slice(0, 40)
        },

        importFromLibrary: async (id) => {
            const actor = state.assets.actors[id]
            if (actor) {
                attachActor(chatId, id)
                return { name: actor.name }
            }
            const note = state.assets.notes[id]
            if (note) {
                attachNote(chatId, id)
                return { name: note.title }
            }
            throw new Error(`Nothing in the library with id ${id}`)
        },

        fetchUrl: async () => WEB_FETCH_UNAVAILABLE,
    }
}

/**
 * Returned when the active provider has no web access. Written as guidance to
 * the model rather than a bare error, so it tells the user what to do instead
 * of retrying or inventing page content.
 */
export const WEB_FETCH_UNAVAILABLE =
    'Web fetch is not available with the currently selected model. Only Anthropic (Claude) models can browse. '
    + 'Tell the user this, and ask them to paste the relevant text if they need it.'

/** Execute one collaborator tool. Shared by both agent paths. */
/**
 * One tool the collaborator ran, for showing the user what it did.
 *
 * Recorded here rather than in either provider loop because both bottom out in
 * `runScenarioTool` — the AI SDK path calls it from `execute`, the Claude path
 * from the `/agent-rpc` handler — so this is the only place that sees every
 * call regardless of transport.
 */
export type ScenarioToolCall = {
    name: string
    args: Record<string, unknown>
    result?: string
    error?: string
}

const recorders = new Map<string, ScenarioToolCall[]>()

/** Collect the calls made while `run` executes, for one scenario's turn. */
export async function recordingToolCalls<T>(
    chatId: string,
    run: () => Promise<T>,
): Promise<{ value: T; calls: ScenarioToolCall[] }> {
    const calls: ScenarioToolCall[] = []
    recorders.set(chatId, calls)
    try {
        return { value: await run(), calls }
    } finally {
        recorders.delete(chatId)
    }
}

export async function runScenarioTool(
    chatId: string,
    name: ScenarioToolName,
    args: Record<string, unknown>,
): Promise<{ result: string } | { error: string }> {
    const outcome = await execute(chatId, name, args)
    const call: ScenarioToolCall = { name, args }
    if ('error' in outcome) call.error = outcome.error
    else call.result = outcome.result
    recorders.get(chatId)?.push(call)
    return outcome
}

async function execute(
    chatId: string,
    name: ScenarioToolName,
    args: Record<string, unknown>,
): Promise<{ result: string } | { error: string }> {
    const spec = SCENARIO_TOOLS[name]
    if (!spec) return { error: `unknown_tool: ${name}` }
    if (!state.assets.chats[chatId]) return { error: `unknown_scenario: ${chatId}` }

    const parsed = spec.schema.safeParse(args)
    if (!parsed.success) return { error: `invalid_args: ${parsed.error.message}` }

    try {
        const result = await spec.run(parsed.data as never, buildScenarioDeps(chatId))
        return { result }
    } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) }
    }
}
