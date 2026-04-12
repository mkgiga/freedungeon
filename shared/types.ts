/**
 * State is read-only on the frontend side.
 * All mutations to state must be done through API calls to the backend.
 *
 * All `createdAt` / `updatedAt` fields are Unix timestamps in **milliseconds**
 * (compatible with `Date.now()` and `new Date(ms)`).
 */
export type AppState = {
    assets: {
        actors: Record<number, Actor>;
        notes: Record<number, Note>;
        llmConfigs: Record<number, LLMConfig>;
        chats: Record<number, Chat>;
    },
    currentChat: CurrentChatState;
    notifications: AppNotification[];
    userPreferences: UserPreferences;
}

export type AppNotification = {
    id: number;
    title: string;
    content: string;
    backgroundColor: string;
    /* whether the notification is just for logging or if it is visible in the UI */
    show: boolean;
    /** whether to show a toast popup */
    toast?: boolean;
    push: boolean;
    textColor: string;
    createdAt: number;
}

/** Name <-> URL */
export type ActorExpressions = { [expressionName: string]: string };

export type Actor = {
    id: number;
    customId: string;
    name: string;
    description: string;
    avatarUrl: string;
    expressions: ActorExpressions;
    createdAt: number;
    updatedAt: number;
}

export type Note = {
    id: number;
    title: string;
    type: string;
    content: string;
    createdAt: number;
    updatedAt: number;
}

export type LLMProvider = 'openai' | 'anthropic' | 'google' | 'custom'

export type LLMConfig = {
    id: number;
    name: string;
    provider: LLMProvider;
    endpoint: string;
    model: string;
    apiKey: string;
    schema: import('@shared/schema-ui').SchemaField[];
    values: Record<string, any>;
    createdAt: number;
    updatedAt: number;
}

export type Chat = {
    id: number;
    title: string;
    assets: {
        actors: number[];
        notes: number[];
    };
    createdAt: number;
    updatedAt: number;
}

/** The in-memory, hydrated version of a chat that's been loaded from the database. */
export type CurrentChatState = {
    id: number | null;
    title: string;
    assets: {
        actors: number[];
        notes: number[];
    };
    /** Keyed by message id. Frontend sorts by id for render order. */
    messages: Record<number, ChatMessage>;
    createdAt: number | null;
    updatedAt: number | null;
}

export type ChatMessage = {
    id: number;
    role: 'user' | 'assistant' | 'system';
    chatId: number;
    content: string;
    createdAt: number;
    updatedAt: number;
    metadata?: Record<string, any>;
}

export type UserChatMessage = ChatMessage & {
    role: 'user';
    /** For preserving what character the user was roleplaying as when they sent this message. */
    actorId?: number;
}
export type UserPreferences = {
    activeLLMConfigId: number | null;
    playerCharacterId: number | null;
    [key: string]: any;
};