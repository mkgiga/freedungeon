
import SQLite from 'bun:sqlite';
import { Kysely, sql, type Generated } from 'kysely';
import { BunSqliteDialect } from 'kysely-bun-sqlite';
import path from 'node:path';
import fs from 'node:fs';
import { state } from './server';
import type { Actor, Note, ChatMessage, AppState, Chat, LLMConfig, AppNotification, CurrentChatState }  from '@shared/types';
export interface DB {
    actor_expressions: {
        id: Generated<number>;
        actor_id: number;
        name: string;
        url: string;
    };
    actors: {
        id: Generated<number>;
        customId: Generated<string>;
        name: Generated<string>;
        description: Generated<string>;
        avatar_url: string;
        created_at: Generated<number>;
        updated_at: Generated<number>;
    };
    notes: {
        id: Generated<number>;
        title: Generated<string>;
        type: Generated<string>;
        content: Generated<string>;
        created_at: Generated<number>;
        updated_at: Generated<number>;
    };
    chat_actor_refs: {
        id: Generated<number>;
        chat_id: number;
        actor_id: number;
    };
    chat_note_refs: {
        id: Generated<number>;
        chat_id: number;
        note_id: number;
    };
    chats: {
        id: Generated<number>;
        title: Generated<string>;
        created_at: Generated<number>;
        updated_at: Generated<number>;
    };
    chat_messages: {
        id: Generated<number>;
        role: string;
        chat_id: number;
        content: string;
        created_at: Generated<number>;
        updated_at: Generated<number>;
        metadata: string | null;
    };
    llm_configs: {
        id: Generated<number>;
        name: Generated<string>;
        provider: string;
        endpoint: string;
        model: string;
        api_key: Generated<string>;
        schema: string;
        values: string;
        created_at: Generated<number>;
        updated_at: Generated<number>;
    };
    notifications: {
        id: Generated<number>;
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
        .addColumn('id', 'integer', (col) => col.primaryKey().autoIncrement())
        .addColumn('customId', 'text', (col) => col.unique().notNull().defaultTo(sql`(lower(hex(randomblob(8))))`))
        .addColumn('name', 'text', (col) => col.notNull().defaultTo('Unnamed Actor'))
        .addColumn('description', 'text', (col) => col.defaultTo('').notNull())
        .addColumn('avatar_url', 'text')
        .addColumn('created_at', 'integer', (col) => col.notNull().defaultTo(sql`(CAST(unixepoch('subsec') * 1000 AS INTEGER))`))
        .addColumn('updated_at', 'integer', (col) => col.notNull().defaultTo(sql`(CAST(unixepoch('subsec') * 1000 AS INTEGER))`))
        .execute();

    await db.schema
        .createTable('actor_expressions')
        .ifNotExists()
        .addColumn('id', 'integer', (col) => col.primaryKey().autoIncrement())
        .addColumn('actor_id', 'integer', (col) => col.notNull().references('actors.id').onDelete('cascade'))
        .addColumn('name', 'text', (col) => col.notNull().defaultTo('unknown'))
        .addColumn('url', 'text', (col) => col.notNull())
        .execute();

    await db.schema
        .createTable('notes')
        .ifNotExists()
        .addColumn('id', 'integer', (col) => col.primaryKey().autoIncrement())
        .addColumn('title', 'text', (col) => col.notNull().defaultTo('Untitled Note'))
        .addColumn('type', 'text', (col) => col.notNull().defaultTo(''))
        .addColumn('content', 'text', (col) => col.notNull().defaultTo(''))
        .addColumn('created_at', 'integer', (col) => col.notNull().defaultTo(sql`(CAST(unixepoch('subsec') * 1000 AS INTEGER))`))
        .addColumn('updated_at', 'integer', (col) => col.notNull().defaultTo(sql`(CAST(unixepoch('subsec') * 1000 AS INTEGER))`))
        .execute();

    await db.schema
        .createTable('chats')
        .ifNotExists()
        .addColumn('id', 'integer', (col) => col.primaryKey().autoIncrement())
        .addColumn('title', 'text', (col) => col.notNull().defaultTo('Untitled Chat'))
        .addColumn('created_at', 'integer', (col) => col.notNull().defaultTo(sql`(CAST(unixepoch('subsec') * 1000 AS INTEGER))`))
        .addColumn('updated_at', 'integer', (col) => col.notNull().defaultTo(sql`(CAST(unixepoch('subsec') * 1000 AS INTEGER))`))
        .execute();

    await db.schema
        .createTable('chat_actor_refs')
        .ifNotExists()
        .addColumn('id', 'integer', (col) => col.primaryKey().autoIncrement())
        .addColumn('chat_id', 'integer', (col) => col.notNull().references('chats.id').onDelete('cascade'))
        .addColumn('actor_id', 'integer', (col) => col.notNull().references('actors.id').onDelete('cascade'))
        .execute();

    await db.schema
        .createTable('chat_note_refs')
        .ifNotExists()
        .addColumn('id', 'integer', (col) => col.primaryKey().autoIncrement())
        .addColumn('chat_id', 'integer', (col) => col.notNull().references('chats.id').onDelete('cascade'))
        .addColumn('note_id', 'integer', (col) => col.notNull().references('notes.id').onDelete('cascade'))
        .execute();

    await db.schema
        .createTable('chat_messages')
        .ifNotExists()
        .addColumn('id', 'integer', (col) => col.primaryKey().autoIncrement())
        .addColumn('role', 'text', (col) => col.notNull())
        .addColumn('chat_id', 'integer', (col) => col.notNull().references('chats.id').onDelete('cascade'))
        .addColumn('content', 'text', (col) => col.notNull())
        .addColumn('created_at', 'integer', (col) => col.notNull().defaultTo(sql`(CAST(unixepoch('subsec') * 1000 AS INTEGER))`))
        .addColumn('updated_at', 'integer', (col) => col.notNull().defaultTo(sql`(CAST(unixepoch('subsec') * 1000 AS INTEGER))`))
        .addColumn('metadata', 'text')
        .execute();

    await db.schema
        .createTable('llm_configs')
        .ifNotExists()
        .addColumn('id', 'integer', (col) => col.primaryKey().autoIncrement())
        .addColumn('name', 'text', (col) => col.notNull().defaultTo('Untitled Config'))
        .addColumn('provider', 'text', (col) => col.notNull())
        .addColumn('endpoint', 'text', (col) => col.notNull())
        .addColumn('model', 'text', (col) => col.notNull())
        .addColumn('api_key', 'text', (col) => col.notNull().defaultTo(''))
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
        .addColumn('id', 'integer', (col) => col.primaryKey().autoIncrement())
        .addColumn('title', 'text', (col) => col.notNull().defaultTo('Notification'))
        .addColumn('content', 'text', (col) => col.notNull())
        .addColumn('background_color', 'text', (col) => col.notNull().defaultTo(''))
        .addColumn('text_color', 'text', (col) => col.notNull().defaultTo(''))
        .addColumn('show', 'integer', (col) => col.notNull().defaultTo(1))
        .addColumn('push', 'integer', (col) => col.notNull().defaultTo(0))
        .addColumn('created_at', 'integer', (col) => col.notNull().defaultTo(sql`(CAST(unixepoch('subsec') * 1000 AS INTEGER))`))
        .execute();

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
        created_at: actor.createdAt,
        updated_at: actor.updatedAt,
    };
}

export function dehydrateNote(note: Note): Omit<Selectable<DB['notes']>, 'id'> {
    return {
        title: note.title,
        type: note.type,
        content: note.content,
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
        noteRefs: chat.assets.notes.map(note_id => ({ note_id })),
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
export async function getMessagesByChatId(chatId: number): Promise<Record<number, ChatMessage>> {
    const rows = await db.selectFrom('chat_messages')
        .selectAll()
        .where('chat_id', '=', chatId)
        .orderBy('id', 'asc')
        .execute();
    const record: Record<number, ChatMessage> = {};
    for (const row of rows) {
        const msg = hydrateChatMessage(row);
        record[msg.id] = msg;
    }
    return record;
}

export async function loadChatById(chatId: number) {
    const loadedChat = await db.selectFrom('chats').selectAll().where('id', '=', chatId).executeTakeFirst();
    if (!loadedChat) throw new Error('Chat not found');
    const chatMessages = await db.selectFrom('chat_messages').selectAll().where('chat_id', '=', chatId).orderBy('created_at', 'asc').execute();

    const actorRefs = await db.selectFrom('chat_actor_refs')
        .select('actor_id')
        .where('chat_id', '=', chatId)
        .execute();

    const noteRefs = await db.selectFrom('chat_note_refs')
        .select('note_id')
        .where('chat_id', '=', chatId)
        .execute();

    const hydratedChat = hydrateChat(loadedChat);
    const messagesRecord: Record<number, ChatMessage> = {};
    for (const row of chatMessages) {
        const m = hydrateChatMessage(row);
        messagesRecord[m.id] = m;
    }
    return {
        id: hydratedChat.id,
        title: hydratedChat.title,
        assets: {
            actors: actorRefs.map(r => r.actor_id),
            notes: noteRefs.map(r => r.note_id),
        },
        messages: messagesRecord,
        createdAt: hydratedChat.createdAt,
        updatedAt: hydratedChat.updatedAt,
    } as typeof state.currentChat;
}

export async function loadAssetLibraryActors() {
    const actors = await db.selectFrom('actors').selectAll().execute();
    const expressions = await db.selectFrom('actor_expressions').selectAll().execute();

    const hydratedActors: Record<number, Actor> = {};
    for (const actor of actors) {
        hydratedActors[actor.id] = hydrateActor(actor, expressions);
    }
    return hydratedActors;
}

export async function loadAssetLibraryNotes() {
    const notes = await db.selectFrom('notes').selectAll().execute();
    const hydratedNotes: Record<number, Note> = {};
    for (const note of notes) {
        hydratedNotes[note.id] = hydrateNote(note);
    }
    return hydratedNotes;
}

/**
 * Loads all chats as lightweight metadata: id, title, timestamps, and asset ref IDs.
 * Does NOT load messages. Matches the shape of the `Chat` type used in `state.assets.chats`.
 */
export async function loadAllChatsLite(): Promise<Record<number, Chat>> {
    const chatRows = await db.selectFrom('chats').selectAll().execute();
    const actorRefs = await db.selectFrom('chat_actor_refs').selectAll().execute();
    const noteRefs = await db.selectFrom('chat_note_refs').selectAll().execute();

    const result: Record<number, Chat> = {};
    for (const row of chatRows) {
        result[row.id] = {
            id: row.id,
            title: row.title,
            assets: {
                actors: actorRefs.filter(r => r.chat_id === row.id).map(r => r.actor_id),
                notes: noteRefs.filter(r => r.chat_id === row.id).map(r => r.note_id),
            },
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
    const llmConfigs: Record<number, LLMConfig> = {};
    for (const row of llmConfigRows) {
        llmConfigs[row.id] = hydrateLLMConfig(row);
    }

    const prefsRow = await db.selectFrom('settings').selectAll().where('key', '=', 'userPreferences').executeTakeFirst();
    const userPreferences = prefsRow
        ? JSON.parse(prefsRow.value)
        : { activeLLMConfigId: null, playerCharacterId: null, theme: 'system' };

    return {
        assets: { actors, notes, llmConfigs, chats },
        currentChat: {
            id: null,
            title: '',
            assets: { actors: [], notes: [] },
            messages: {},
            createdAt: null,
            updatedAt: null,
        },
        notifications: [],
        userPreferences,
    };
}

export function saveStateToDb({ state: appState }: { state: AppState }) {
    const actorValues = Object.values(appState.assets.actors)
    console.log(`[DB] Saving state: ${actorValues.length} actors, ${Object.values(appState.assets.notes).length} notes`)

    // No await — bun:sqlite is synchronous, Kysely wraps in Promise.resolve()
    // .execute() completes the DB write synchronously regardless of await
    for (const actor of actorValues) {
        db.insertInto('actors')
            .values({ id: actor.id, ...dehydrateActor(actor) })
            .onConflict((oc) => oc.column('id').doUpdateSet(dehydrateActor(actor)))
            .execute()

        db.deleteFrom('actor_expressions').where('actor_id', '=', actor.id).execute()
        for (const [name, url] of Object.entries(actor.expressions)) {
            db.insertInto('actor_expressions').values({ actor_id: actor.id, name, url }).execute()
        }
    }

    for (const note of Object.values(appState.assets.notes)) {
        db.insertInto('notes')
            .values({ id: note.id, ...dehydrateNote(note) })
            .onConflict((oc) => oc.column('id').doUpdateSet(dehydrateNote(note)))
            .execute()
    }

    for (const config of Object.values(appState.assets.llmConfigs)) {
        db.insertInto('llm_configs')
            .values({ id: config.id, ...dehydrateLLMConfig(config) })
            .onConflict((oc) => oc.column('id').doUpdateSet(dehydrateLLMConfig(config)))
            .execute()
    }

    // Persist all chats (metadata + asset refs) from state.assets.chats
    for (const chat of Object.values(appState.assets.chats)) {
        db.insertInto('chats')
            .values({
                id: chat.id,
                title: chat.title,
                created_at: chat.createdAt,
                updated_at: chat.updatedAt,
            })
            .onConflict((oc) => oc.column('id').doUpdateSet({
                title: chat.title,
                created_at: chat.createdAt,
                updated_at: chat.updatedAt,
            }))
            .execute()

        // Sync actor/note refs: delete old, insert current
        db.deleteFrom('chat_actor_refs').where('chat_id', '=', chat.id).execute()
        for (const actorId of chat.assets.actors) {
            db.insertInto('chat_actor_refs').values({ chat_id: chat.id, actor_id: actorId }).execute()
        }
        db.deleteFrom('chat_note_refs').where('chat_id', '=', chat.id).execute()
        for (const noteId of chat.assets.notes) {
            db.insertInto('chat_note_refs').values({ chat_id: chat.id, note_id: noteId }).execute()
        }
    }

    // Persist current chat's messages (only the currently-loaded chat has messages in memory)
    if (appState.currentChat.id !== null) {
        const messageIds: number[] = []
        for (const msg of Object.values(appState.currentChat.messages)) {
            messageIds.push(msg.id)
            db.insertInto('chat_messages')
                .values({ id: msg.id, ...dehydrateChatMessage(msg) })
                .onConflict((oc) => oc.column('id').doUpdateSet(dehydrateChatMessage(msg)))
                .execute()
        }
        // Delete any messages in the DB for this chat that are no longer in memory
        // (handles deletions made during the session)
        if (messageIds.length > 0) {
            db.deleteFrom('chat_messages')
                .where('chat_id', '=', appState.currentChat.id)
                .where('id', 'not in', messageIds)
                .execute()
        } else {
            db.deleteFrom('chat_messages')
                .where('chat_id', '=', appState.currentChat.id)
                .execute()
        }
    }

    const prefsJson = JSON.stringify(appState.userPreferences)
    db.insertInto('settings')
        .values({ key: 'userPreferences', value: prefsJson })
        .onConflict((oc) => oc.column('key').doUpdateSet({ value: prefsJson }))
        .execute()

    console.log(`[DB] Save complete.`)
}

export default { get db() { return db }, initDb, saveStateToDb };
