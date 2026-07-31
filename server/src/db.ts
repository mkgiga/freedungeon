
import SQLite from 'bun:sqlite';
import { Kysely, sql, type Generated } from 'kysely';
import { BunSqliteDialect } from 'kysely-bun-sqlite';
import { nanoid } from 'nanoid';
import path from 'node:path';
import fs from 'node:fs';
import { state } from './server';
import { savePreferences } from './preferences';
import type { Actor, Note, ChatMessage, AppState, Chat, LLMConfig, AppNotification, CurrentChatState }  from '@shared/types';
export interface DB {
    actor_expressions: {
        id: string;
        actor_id: string;
        name: string;
        url: string;
    };
    actors: {
        id: string;
        customId: Generated<string>;
        name: Generated<string>;
        description: Generated<string>;
        avatar_url: string;
        group: string | null;
        created_at: Generated<number>;
        updated_at: Generated<number>;
    };
    notes: {
        id: string;
        title: Generated<string>;
        type: Generated<string>;
        content: Generated<string>;
        emoji: string | null;
        created_at: Generated<number>;
        updated_at: Generated<number>;
    };
    chat_actor_refs: {
        id: string;
        chat_id: string;
        actor_id: string;
    };
    chat_note_refs: {
        id: string;
        chat_id: string;
        note_id: string;
        enabled: Generated<number>;
    };
    chats: {
        id: string;
        title: Generated<string>;
        is_template: Generated<number>;
        avatar_url: string | null;
        banner_url: string | null;
        description: string | null;
        agent_session_id: string | null;
        /**
         * JSON snapshot of GameStateContext.flags taken at the end of the
         * most recent agent turn. dispatchPromptToAgent diffs against this
         * to build a <state_changes_since_last_turn> block in the next
         * user prompt, so the agent notices out-of-band flag changes
         * (e.g. user toggles via UI) without having to call list_flags
         * defensively every turn.
         */
        last_agent_flags_snapshot: string | null;
        /** OpenAI-v1 agentic loop transcript (JSON ModelMessage[]) — the model's
         *  memory for the AI SDK path, the provider-agnostic analog of
         *  agent_session_id (which points at the Claude SDK's own session). */
        ai_transcript: string | null;
        /** Which agent loop last advanced this chat ('claude' | 'ai-sdk'). On a
         *  provider switch the now-active loop rehydrates from the ChatMessage
         *  log instead of resuming its (stale) private memory. */
        last_agent_loop: string | null;
        created_at: Generated<number>;
        updated_at: Generated<number>;
    };
    chat_messages: {
        id: string;
        role: string;
        chat_id: string;
        content: string;
        created_at: Generated<number>;
        updated_at: Generated<number>;
        metadata: string | null;
    };
    llm_configs: {
        id: string;
        name: Generated<string>;
        provider: string;
        endpoint: string;
        model: string;
        api_key: Generated<string>;
        system_prompt: Generated<string>;
        schema: string;
        values: string;
        created_at: Generated<number>;
        updated_at: Generated<number>;
    };
    notifications: {
        id: string;
        title: Generated<string>;
        content: string;
        background_color: Generated<string>;
        text_color: Generated<string>;
        show: Generated<number>;
        push: Generated<number>;
        created_at: Generated<number>;
    };
    settings: {
        key: string;
        value: string;
    };
}

export let db: Kysely<DB>;
let rawDb: InstanceType<typeof SQLite>;

export async function initDb() {
    const dataDirPath = path.join(import.meta.dirname, '..', 'data');
    const dbDirPath = path.join(dataDirPath, 'db');

    fs.mkdirSync(dbDirPath, { recursive: true });

    rawDb = new SQLite(path.join(dbDirPath, 'db.sqlite'));
    db = new Kysely<DB>({
        dialect: new BunSqliteDialect({ database: rawDb }),
    });
    await sql`PRAGMA journal_mode = WAL;`.execute(db);
    await sql`PRAGMA synchronous = NORMAL;`.execute(db);
    await sql`PRAGMA foreign_keys = ON;`.execute(db);
    await db.schema
        .createTable('actors')
        .ifNotExists()
        .addColumn('id', 'text', (col) => col.primaryKey().notNull())
        .addColumn('customId', 'text', (col) => col.unique().notNull().defaultTo(sql`(lower(hex(randomblob(8))))`))
        .addColumn('name', 'text', (col) => col.notNull().defaultTo('Unnamed Actor'))
        .addColumn('description', 'text', (col) => col.defaultTo('').notNull())
        .addColumn('avatar_url', 'text')
        .addColumn('group', 'text')
        .addColumn('created_at', 'integer', (col) => col.notNull().defaultTo(sql`(CAST(unixepoch('subsec') * 1000 AS INTEGER))`))
        .addColumn('updated_at', 'integer', (col) => col.notNull().defaultTo(sql`(CAST(unixepoch('subsec') * 1000 AS INTEGER))`))
        .execute();

    // Self-healing migrations: add columns to pre-existing actors tables.
    // Purely additive ALTERs (no drop/recreate) so existing data is preserved.
    const actorCols = await sql<{ name: string }>`PRAGMA table_info(actors)`.execute(db);
    if (!actorCols.rows.some(r => r.name === 'group')) {
        await db.schema.alterTable('actors').addColumn('group', 'text').execute();
    }

    await db.schema
        .createTable('actor_expressions')
        .ifNotExists()
        .addColumn('id', 'text', (col) => col.primaryKey().notNull())
        .addColumn('actor_id', 'text', (col) => col.notNull().references('actors.id').onDelete('cascade'))
        .addColumn('name', 'text', (col) => col.notNull().defaultTo('unknown'))
        .addColumn('url', 'text', (col) => col.notNull())
        .execute();

    await db.schema
        .createTable('notes')
        .ifNotExists()
        .addColumn('id', 'text', (col) => col.primaryKey().notNull())
        .addColumn('title', 'text', (col) => col.notNull().defaultTo('Untitled Note'))
        .addColumn('type', 'text', (col) => col.notNull().defaultTo(''))
        .addColumn('content', 'text', (col) => col.notNull().defaultTo(''))
        .addColumn('emoji', 'text')
        .addColumn('created_at', 'integer', (col) => col.notNull().defaultTo(sql`(CAST(unixepoch('subsec') * 1000 AS INTEGER))`))
        .addColumn('updated_at', 'integer', (col) => col.notNull().defaultTo(sql`(CAST(unixepoch('subsec') * 1000 AS INTEGER))`))
        .execute();

    // Self-healing migration: add `emoji` column to existing notes tables that
    // predate it. `createTable().ifNotExists()` is a no-op if the table already
    // exists, so new columns don't reach old DBs without an explicit ALTER.
    const notesCols = await sql<{ name: string }>`PRAGMA table_info(notes)`.execute(db);
    if (!notesCols.rows.some(r => r.name === 'emoji')) {
        await db.schema.alterTable('notes').addColumn('emoji', 'text').execute();
    }

    await db.schema
        .createTable('chats')
        .ifNotExists()
        .addColumn('id', 'text', (col) => col.primaryKey().notNull())
        .addColumn('title', 'text', (col) => col.notNull().defaultTo('Untitled Chat'))
        .addColumn('is_template', 'integer', (col) => col.notNull().defaultTo(0))
        .addColumn('avatar_url', 'text')
        .addColumn('banner_url', 'text')
        .addColumn('description', 'text')
        .addColumn('created_at', 'integer', (col) => col.notNull().defaultTo(sql`(CAST(unixepoch('subsec') * 1000 AS INTEGER))`))
        .addColumn('updated_at', 'integer', (col) => col.notNull().defaultTo(sql`(CAST(unixepoch('subsec') * 1000 AS INTEGER))`))
        .execute();

    // Self-healing migrations: add new columns to pre-existing chats tables.
    const chatCols = await sql<{ name: string }>`PRAGMA table_info(chats)`.execute(db);
    const haveChatCol = (name: string) => chatCols.rows.some(r => r.name === name);
    if (!haveChatCol('is_template')) {
        await db.schema.alterTable('chats').addColumn('is_template', 'integer', (col) => col.notNull().defaultTo(0)).execute();
    }
    if (!haveChatCol('avatar_url')) {
        await db.schema.alterTable('chats').addColumn('avatar_url', 'text').execute();
    }
    if (!haveChatCol('banner_url')) {
        await db.schema.alterTable('chats').addColumn('banner_url', 'text').execute();
    }
    if (!haveChatCol('description')) {
        await db.schema.alterTable('chats').addColumn('description', 'text').execute();
    }
    if (!haveChatCol('agent_session_id')) {
        await db.schema.alterTable('chats').addColumn('agent_session_id', 'text').execute();
    }
    if (!haveChatCol('last_agent_flags_snapshot')) {
        await db.schema.alterTable('chats').addColumn('last_agent_flags_snapshot', 'text').execute();
    }
    if (!haveChatCol('ai_transcript')) {
        await db.schema.alterTable('chats').addColumn('ai_transcript', 'text').execute();
    }
    if (!haveChatCol('last_agent_loop')) {
        await db.schema.alterTable('chats').addColumn('last_agent_loop', 'text').execute();
    }

    await db.schema
        .createTable('chat_actor_refs')
        .ifNotExists()
        .addColumn('id', 'text', (col) => col.primaryKey().notNull())
        .addColumn('chat_id', 'text', (col) => col.notNull().references('chats.id').onDelete('cascade'))
        .addColumn('actor_id', 'text', (col) => col.notNull().references('actors.id').onDelete('cascade'))
        .execute();

    await db.schema
        .createTable('chat_note_refs')
        .ifNotExists()
        .addColumn('id', 'text', (col) => col.primaryKey().notNull())
        .addColumn('chat_id', 'text', (col) => col.notNull().references('chats.id').onDelete('cascade'))
        .addColumn('note_id', 'text', (col) => col.notNull().references('notes.id').onDelete('cascade'))
        .addColumn('enabled', 'integer', (col) => col.notNull().defaultTo(1))
        .execute();

    // Self-healing migration: per-ref `enabled` flag (replaces the hotbar-notes feature).
    const noteRefCols = await sql<{ name: string }>`PRAGMA table_info(chat_note_refs)`.execute(db);
    if (!noteRefCols.rows.some(r => r.name === 'enabled')) {
        await db.schema.alterTable('chat_note_refs').addColumn('enabled', 'integer', (col) => col.notNull().defaultTo(1)).execute();
    }

    // ── One-time hotbar-notes teardown ──
    // Carry disabled flags into chat_note_refs, then drop the table. Guarded on
    // table existence so it's idempotent — a no-op on fresh DBs and on re-run.
    // Hotbar rows for notes not attached to the chat had no prompt effect and
    // are intentionally dropped.
    const hotbarTable = await sql<{ name: string }>`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'chat_hotbar_notes'`.execute(db);
    if (hotbarTable.rows.length > 0) {
        await sql`
            UPDATE chat_note_refs SET enabled = 0
            WHERE EXISTS (
                SELECT 1 FROM chat_hotbar_notes h
                WHERE h.chat_id = chat_note_refs.chat_id
                  AND h.note_id = chat_note_refs.note_id
                  AND h.enabled = 0
            )`.execute(db);
        await db.schema.dropTable('chat_hotbar_notes').execute();
    }

    await db.schema
        .createTable('chat_messages')
        .ifNotExists()
        .addColumn('id', 'text', (col) => col.primaryKey().notNull())
        .addColumn('role', 'text', (col) => col.notNull())
        .addColumn('chat_id', 'text', (col) => col.notNull().references('chats.id').onDelete('cascade'))
        .addColumn('content', 'text', (col) => col.notNull())
        .addColumn('created_at', 'integer', (col) => col.notNull().defaultTo(sql`(CAST(unixepoch('subsec') * 1000 AS INTEGER))`))
        .addColumn('updated_at', 'integer', (col) => col.notNull().defaultTo(sql`(CAST(unixepoch('subsec') * 1000 AS INTEGER))`))
        .addColumn('metadata', 'text')
        .execute();

    await db.schema
        .createTable('llm_configs')
        .ifNotExists()
        .addColumn('id', 'text', (col) => col.primaryKey().notNull())
        .addColumn('name', 'text', (col) => col.notNull().defaultTo('Untitled Config'))
        .addColumn('provider', 'text', (col) => col.notNull())
        .addColumn('endpoint', 'text', (col) => col.notNull())
        .addColumn('model', 'text', (col) => col.notNull())
        .addColumn('api_key', 'text', (col) => col.notNull().defaultTo(''))
        .addColumn('system_prompt', 'text', (col) => col.notNull().defaultTo(''))
        .addColumn('schema', 'text', (col) => col.notNull().defaultTo('[]'))
        .addColumn('values', 'text', (col) => col.notNull().defaultTo('{}'))
        .addColumn('created_at', 'integer', (col) => col.notNull().defaultTo(sql`(CAST(unixepoch('subsec') * 1000 AS INTEGER))`))
        .addColumn('updated_at', 'integer', (col) => col.notNull().defaultTo(sql`(CAST(unixepoch('subsec') * 1000 AS INTEGER))`))
        .execute();

    await db.schema
        .createTable('settings')
        .ifNotExists()
        .addColumn('key', 'text', (col) => col.primaryKey().notNull())
        .addColumn('value', 'text', (col) => col.notNull())
        .execute();

    await db.schema
        .createTable('notifications')
        .ifNotExists()
        .addColumn('id', 'text', (col) => col.primaryKey().notNull())
        .addColumn('title', 'text', (col) => col.notNull().defaultTo('Notification'))
        .addColumn('content', 'text', (col) => col.notNull())
        .addColumn('background_color', 'text', (col) => col.notNull().defaultTo(''))
        .addColumn('text_color', 'text', (col) => col.notNull().defaultTo(''))
        .addColumn('show', 'integer', (col) => col.notNull().defaultTo(1))
        .addColumn('push', 'integer', (col) => col.notNull().defaultTo(0))
        .addColumn('created_at', 'integer', (col) => col.notNull().defaultTo(sql`(CAST(unixepoch('subsec') * 1000 AS INTEGER))`))
        .execute();

    // ── One-time TTS teardown ──
    // The DramaBox voice-acting feature was removed; drop its columns and strip
    // its message metadata if present. Guarded + idempotent: a no-op on DBs that
    // never had the feature and safe to re-run. No data loss beyond the dead TTS
    // fields. (SQLite DROP COLUMN needs 3.35+, which Bun bundles.)
    const ttsActorCols = await sql<{ name: string }>`PRAGMA table_info(actors)`.execute(db);
    if (ttsActorCols.rows.some(r => r.name === 'voice_ref')) {
        await db.schema.alterTable('actors').dropColumn('voice_ref').execute();
    }
    const ttsChatCols = await sql<{ name: string }>`PRAGMA table_info(chats)`.execute(db);
    if (ttsChatCols.rows.some(r => r.name === 'agent_session_features')) {
        await db.schema.alterTable('chats').dropColumn('agent_session_features').execute();
    }
    await sql`UPDATE chat_messages SET metadata = json_remove(metadata, '$.tts') WHERE metadata IS NOT NULL AND json_extract(metadata, '$.tts') IS NOT NULL`.execute(db);

    console.log('Database initialized.');
}

// ── Hydration ──

import type { Selectable } from 'kysely';

type ActorRow = Selectable<DB['actors']>;
type ExpressionRow = Selectable<DB['actor_expressions']>;
type NotificationRow = Selectable<DB['notifications']>;
type NoteRow = Selectable<DB['notes']>;
type ChatMessageRow = Selectable<DB['chat_messages']>;
type ChatRow = Selectable<DB['chats']>;
type LLMConfigRow = Selectable<DB['llm_configs']>;

export function hydrateActor(row: ActorRow, expressions: ExpressionRow[]): Actor {
    return {
        id: row.id,
        customId: row.customId,
        name: row.name,
        description: row.description,
        avatarUrl: row.avatar_url,
        group: row.group ?? undefined,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        expressions: Object.fromEntries(
            expressions
                .filter(exp => exp.actor_id === row.id)
                .map(exp => [exp.name, exp.url])
        ),
    };
}

export function hydrateNote(row: NoteRow): Note {
    return {
        id: row.id,
        title: row.title,
        type: row.type,
        content: row.content,
        emoji: row.emoji ?? undefined,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
}

export function hydrateChatMessage(row: ChatMessageRow): ChatMessage {
    return {
        id: row.id,
        role: row.role as ChatMessage['role'],
        chatId: row.chat_id,
        content: row.content,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        metadata: JSON.parse(row.metadata || '{}'),
    };
}

export function hydrateChat(row: ChatRow) {
    return {
        id: row.id,
        title: row.title,
        isTemplate: row.is_template !== 0,
        avatarUrl: row.avatar_url ?? undefined,
        bannerUrl: row.banner_url ?? undefined,
        description: row.description ?? undefined,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
}

export function hydrateLLMConfig(row: LLMConfigRow): LLMConfig {
    return {
        id: row.id,
        name: row.name,
        provider: row.provider as LLMConfig['provider'],
        endpoint: row.endpoint,
        model: row.model,
        apiKey: row.api_key,
        systemPrompt: row.system_prompt,
        schema: JSON.parse(row.schema),
        values: JSON.parse(row.values),
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
}

export function dehydrateLLMConfig(config: LLMConfig): Omit<Selectable<DB['llm_configs']>, 'id'> {
    return {
        name: config.name,
        provider: config.provider,
        endpoint: config.endpoint,
        model: config.model,
        api_key: config.apiKey,
        system_prompt: config.systemPrompt,
        schema: JSON.stringify(config.schema),
        values: JSON.stringify(config.values),
        created_at: config.createdAt,
        updated_at: config.updatedAt,
    };
}

export function hydrateNotification(row: NotificationRow): AppNotification {
    return {
        id: row.id,
        title: row.title,
        content: row.content,
        backgroundColor: row.background_color,
        textColor: row.text_color,
        show: row.show === 1,
        push: row.push === 1,
        createdAt: row.created_at,
    };
}

// ── Dehydration (App → DB) ──

export function dehydrateActor(actor: Actor): Omit<Selectable<DB['actors']>, 'id'> {
    return {
        customId: actor.customId,
        name: actor.name,
        description: actor.description,
        avatar_url: actor.avatarUrl,
        group: actor.group ?? null,
        created_at: actor.createdAt,
        updated_at: actor.updatedAt,
    };
}

export function dehydrateNote(note: Note): Omit<Selectable<DB['notes']>, 'id'> {
    return {
        title: note.title,
        type: note.type,
        content: note.content,
        emoji: note.emoji ?? null,
        created_at: note.createdAt,
        updated_at: note.updatedAt,
    };
}

export function dehydrateChatMessage(msg: ChatMessage): Omit<Selectable<DB['chat_messages']>, 'id'> {
    return {
        role: msg.role,
        chat_id: msg.chatId,
        content: msg.content,
        created_at: msg.createdAt,
        updated_at: msg.updatedAt,
        metadata: msg.metadata ? JSON.stringify(msg.metadata) : null,
    };
}

/**
 * Dehydrates a CurrentChatState into its chat row + actor/note refs for persistence.
 * Messages are NOT included — use `dehydrateChatMessage` per-message instead.
 * `createdAt` / `updatedAt` fall back to now for brand-new (unsaved) chats.
 */
export function dehydrateCurrentChat(chat: CurrentChatState) {
    const now = Date.now();
    return {
        chat: {
            title: chat.title,
            created_at: chat.createdAt ?? now,
            updated_at: chat.updatedAt ?? now,
        },
        actorRefs: chat.assets.actors.map(actor_id => ({ actor_id })),
        noteRefs: Object.entries(chat.assets.notes).map(([note_id, ref]) => ({ note_id, enabled: ref.enabled ? 1 : 0 })),
    };
}

// ── Queries ──

export function listChats({ offset = 0, limit = 20 }) {
    return db.selectFrom('chats')
        .selectAll()
        .orderBy('updated_at', 'desc')
        .limit(limit)
        .offset(offset)
        .execute();
}

/**
 * Loads all messages for a given chat, hydrated into a record keyed by message id.
 * Matches the shape of `CurrentChatState.messages`.
 */
export async function getMessagesByChatId(chatId: string): Promise<Record<string, ChatMessage>> {
    const rows = await db.selectFrom('chat_messages')
        .selectAll()
        .where('chat_id', '=', chatId)
        .orderBy('created_at', 'asc')
        .orderBy('id', 'asc')
        .execute();
    const record: Record<string, ChatMessage> = {};
    for (const row of rows) {
        const msg = hydrateChatMessage(row);
        record[msg.id] = msg;
    }
    return record;
}

export async function loadChatById(chatId: string) {
    const loadedChat = await db.selectFrom('chats').selectAll().where('id', '=', chatId).executeTakeFirst();
    if (!loadedChat) throw new Error('Chat not found');
    const chatMessages = await db.selectFrom('chat_messages').selectAll().where('chat_id', '=', chatId).orderBy('created_at', 'asc').orderBy('id', 'asc').execute();

    const actorRefs = await db.selectFrom('chat_actor_refs')
        .select('actor_id')
        .where('chat_id', '=', chatId)
        .execute();

    const noteRefs = await db.selectFrom('chat_note_refs')
        .select(['note_id', 'enabled'])
        .where('chat_id', '=', chatId)
        .execute();

    const hydratedChat = hydrateChat(loadedChat);
    const messagesRecord: Record<string, ChatMessage> = {};
    for (const row of chatMessages) {
        const m = hydrateChatMessage(row);
        messagesRecord[m.id] = m;
    }
    // Compute the "next prompt will rehydrate the agent's memory" flag.
    // Non-null iff there's no SDK session yet but the chat has messages
    // whose history needs to be replayed into the model on the next
    // prompt. Estimated tokens use a char/4 heuristic — fast and good
    // enough for a warning; real token count comes from the API on the
    // first response.
    // Only when neither loop has live memory — no Claude session AND no AI-SDK
    // transcript — does the next prompt actually rehydrate. An AI-SDK chat keeps
    // its memory in ai_transcript (agent_session_id stays null), so without the
    // transcript check the warning would show on every AI-SDK chat load.
    let agentRehydration: { messageCount: number; estimatedTokens: number } | null = null;
    if ((loadedChat.agent_session_id ?? null) === null && !loadedChat.ai_transcript) {
        const msgs = Object.values(messagesRecord);
        if (msgs.length > 0) {
            const chars = msgs.reduce((sum, m) => sum + m.content.length, 0);
            agentRehydration = {
                messageCount: msgs.length,
                estimatedTokens: Math.ceil(chars / 4),
            };
        }
    }

    return {
        id: hydratedChat.id,
        title: hydratedChat.title,
        assets: {
            actors: actorRefs.map(r => r.actor_id),
            notes: Object.fromEntries(noteRefs.map(r => [r.note_id, { enabled: r.enabled !== 0 }])),
        },
        messages: messagesRecord,
        // Placeholder — CurrentChat.loadChat recomputes this from messages via
        // runTurn immediately after setState('currentChat', loadedChat).
        gameState: { inventory: {}, itemDefs: {}, scene: { actors: { active: {}, offscreen: {} } }, flags: {} },
        agentRehydration,
        pendingSystemNotice: '',
        createdAt: hydratedChat.createdAt,
        updatedAt: hydratedChat.updatedAt,
    } as typeof state.currentChat;
}

export async function loadAssetLibraryActors() {
    const actors = await db.selectFrom('actors').selectAll().execute();
    const expressions = await db.selectFrom('actor_expressions').selectAll().execute();

    const hydratedActors: Record<string, Actor> = {};
    for (const actor of actors) {
        hydratedActors[actor.id] = hydrateActor(actor, expressions);
    }
    return hydratedActors;
}

export async function loadAssetLibraryNotes() {
    const notes = await db.selectFrom('notes').selectAll().execute();
    const hydratedNotes: Record<string, Note> = {};
    for (const note of notes) {
        hydratedNotes[note.id] = hydrateNote(note);
    }
    return hydratedNotes;
}

/**
 * Loads all chats as lightweight metadata: id, title, timestamps, and asset ref IDs.
 * Does NOT load messages. Matches the shape of the `Chat` type used in `state.assets.chats`.
 */
export async function loadAllChatsLite(): Promise<Record<string, Chat>> {
    const chatRows = await db.selectFrom('chats').selectAll().execute();
    const actorRefs = await db.selectFrom('chat_actor_refs').selectAll().execute();
    const noteRefs = await db.selectFrom('chat_note_refs').selectAll().execute();

    const result: Record<string, Chat> = {};
    for (const row of chatRows) {
        result[row.id] = {
            id: row.id,
            title: row.title,
            assets: {
                actors: actorRefs.filter(r => r.chat_id === row.id).map(r => r.actor_id),
                notes: Object.fromEntries(noteRefs.filter(r => r.chat_id === row.id).map(r => [r.note_id, { enabled: r.enabled !== 0 }])),
            },
            isTemplate: row.is_template !== 0,
            avatarUrl: row.avatar_url ?? undefined,
            bannerUrl: row.banner_url ?? undefined,
            description: row.description ?? undefined,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
        };
    }
    return result;
}

export async function loadStateFromDb(): Promise<AppState> {
    const actors = await loadAssetLibraryActors();
    const notes = await loadAssetLibraryNotes();
    const chats = await loadAllChatsLite();
    const llmConfigRows = await db.selectFrom('llm_configs').selectAll().execute();
    const llmConfigs: Record<string, LLMConfig> = {};
    for (const row of llmConfigRows) {
        llmConfigs[row.id] = hydrateLLMConfig(row);
    }

    const prefsRow = await db.selectFrom('settings').selectAll().where('key', '=', 'userPreferences').executeTakeFirst();
    const userPreferences = prefsRow
        ? JSON.parse(prefsRow.value)
        : { activeLLMConfigId: null, playerCharacterId: null, theme: 'system', enableChoicePrompts: false };

    return {
        assets: { actors, notes, llmConfigs, chats },
        // Always empty on boot: activities are runtime-only and never persisted.
        activities: {},
        currentChat: {
            id: null,
            title: '',
            assets: { actors: [], notes: {} },
            messages: {},
            gameState: { inventory: {}, itemDefs: {}, scene: { actors: { active: {}, offscreen: {} } }, flags: {} },
            agentRehydration: null,
            pendingSystemNotice: '',
            createdAt: null,
            updatedAt: null,
        },
        isGenerating: false,
        notifications: [],
        userPreferences,
    };
}

// ── Delete helpers ──
// Foreign-key CASCADE (set up in initDb) handles all children when a parent row
// is deleted. These are called at the site of deletion (inside tRPC mutations)
// so in-memory state and the DB stay in lockstep — no "sync on save" sweep.

export function deleteActor(id: string) {
    // CASCADE: actor_expressions, chat_actor_refs
    db.deleteFrom('actors').where('id', '=', id).execute()
}

export function deleteNote(id: string) {
    // CASCADE: chat_note_refs
    db.deleteFrom('notes').where('id', '=', id).execute()
}

export function deleteChat(id: string) {
    // CASCADE: chat_messages, chat_actor_refs, chat_note_refs
    db.deleteFrom('chats').where('id', '=', id).execute()
}

export function deleteLLMConfig(id: string) {
    db.deleteFrom('llm_configs').where('id', '=', id).execute()
}

/** Inserts or updates a single chat message row. */
export function saveMessage(msg: ChatMessage) {
    db.insertInto('chat_messages')
        .values({ id: msg.id, ...dehydrateChatMessage(msg) })
        .onConflict((oc) => oc.column('id').doUpdateSet(dehydrateChatMessage(msg)))
        .execute()
}

/**
 * Persists a single chat's row, actor/note refs, and optionally its messages.
 * Called by `persistPath` (without messages, on every chat mutation) and by
 * branch/clone (with messages, for bulk copies).
 */
export function saveChat(chat: Chat, messages?: Record<string, ChatMessage>) {
    const row = {
        title: chat.title,
        is_template: chat.isTemplate ? 1 : 0,
        avatar_url: chat.avatarUrl ?? null,
        banner_url: chat.bannerUrl ?? null,
        description: chat.description ?? null,
        created_at: chat.createdAt,
        updated_at: chat.updatedAt,
    }
    db.insertInto('chats')
        .values({ id: chat.id, ...row })
        .onConflict((oc) => oc.column('id').doUpdateSet(row))
        .execute()

    db.deleteFrom('chat_actor_refs').where('chat_id', '=', chat.id).execute()
    for (const actorId of chat.assets.actors) {
        db.insertInto('chat_actor_refs').values({ id: nanoid(), chat_id: chat.id, actor_id: actorId }).execute()
    }
    db.deleteFrom('chat_note_refs').where('chat_id', '=', chat.id).execute()
    for (const [noteId, ref] of Object.entries(chat.assets.notes)) {
        db.insertInto('chat_note_refs').values({ id: nanoid(), chat_id: chat.id, note_id: noteId, enabled: ref.enabled ? 1 : 0 }).execute()
    }

    if (messages) {
        // SAVEPOINT so a large message set commits once instead of once per
        // row.
        rawDb.exec('SAVEPOINT save_chat_messages')
        try {
            for (const msg of Object.values(messages)) {
                db.insertInto('chat_messages')
                    .values({ id: msg.id, ...dehydrateChatMessage(msg) })
                    .onConflict((oc) => oc.column('id').doUpdateSet(dehydrateChatMessage(msg)))
                    .execute()
            }
            rawDb.exec('RELEASE save_chat_messages')
        } catch (err) {
            rawDb.exec('ROLLBACK TO save_chat_messages')
            rawDb.exec('RELEASE save_chat_messages')
            throw err
        }
    }
}

/** Upserts a single actor row and rewrites its expressions. */
export function saveActor(actor: Actor) {
    db.insertInto('actors')
        .values({ id: actor.id, ...dehydrateActor(actor) })
        .onConflict((oc) => oc.column('id').doUpdateSet(dehydrateActor(actor)))
        .execute()

    db.deleteFrom('actor_expressions').where('actor_id', '=', actor.id).execute()
    for (const [name, url] of Object.entries(actor.expressions)) {
        db.insertInto('actor_expressions').values({ id: nanoid(), actor_id: actor.id, name, url }).execute()
    }
}

/** Upserts a single note row. */
export function saveNote(note: Note) {
    db.insertInto('notes')
        .values({ id: note.id, ...dehydrateNote(note) })
        .onConflict((oc) => oc.column('id').doUpdateSet(dehydrateNote(note)))
        .execute()
}

/** Upserts a single LLM config row. */
export function saveLLMConfig(config: LLMConfig) {
    db.insertInto('llm_configs')
        .values({ id: config.id, ...dehydrateLLMConfig(config) })
        .onConflict((oc) => oc.column('id').doUpdateSet(dehydrateLLMConfig(config)))
        .execute()
}

/**
 * Persist whatever entity a state path touches. Called by the `setState`/
 * `deleteState` wrappers in server.ts — the same interception point that
 * emits socket patches to the client — so the DB stays in sync with app
 * state without call sites remembering to save.
 *
 * Entity present in state → upsert; absent → delete. That single rule covers
 * both setState and deleteState. Non-persistable roots (currentChat.gameState,
 * isGenerating, notifications, …) fall through. All writes are synchronous
 * (bun:sqlite) and per-entity, ~tens of µs each.
 *
 * NOTE: whole-collection writes (path shorter than [root, collection, id])
 * are intentionally ignored — the only such write is boot hydration, whose
 * data just came FROM the db.
 */
export function persistPath(path: readonly unknown[]) {
    const [root, a, b] = path
    if (root === 'userPreferences') {
        savePreferences(state.userPreferences)
        return
    }
    if (root === 'currentChat' && a === 'messages' && typeof b === 'string') {
        const msg = state.currentChat.messages[b]
        if (msg) saveMessage(msg)
        else db.deleteFrom('chat_messages').where('id', '=', b).execute()
        return
    }
    if (root !== 'assets' || typeof b !== 'string') return
    switch (a) {
        case 'chats': {
            const chat = state.assets.chats[b]
            // CASCADE removes chat_messages and ref rows on delete.
            if (chat) saveChat(chat)
            else deleteChat(b)
            return
        }
        case 'actors': {
            const actor = state.assets.actors[b]
            if (actor) saveActor(actor)
            else deleteActor(b)
            return
        }
        case 'notes': {
            const note = state.assets.notes[b]
            if (note) saveNote(note)
            else deleteNote(b)
            return
        }
        case 'llmConfigs': {
            const config = state.assets.llmConfigs[b]
            if (config) saveLLMConfig(config)
            else deleteLLMConfig(b)
            return
        }
    }
}

export default { get db() { return db }, initDb };
