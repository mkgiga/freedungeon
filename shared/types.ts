/**
 * State is read-only on the frontend side.
 * All mutations to state must be done through API calls to the backend.
 *
 * All `createdAt` / `updatedAt` fields are Unix timestamps in **milliseconds**
 * (compatible with `Date.now()` and `new Date(ms)`).
 */
export type AppState = {
    assets: {
        actors: Record<string, Actor>;
        notes: Record<string, Note>;
        llmConfigs: Record<string, LLMConfig>;
        chats: Record<string, Chat>;
    },
    currentChat: CurrentChatState;
    notifications: AppNotification[];
    userPreferences: UserPreferences;
}

export type AppNotification = {
    id: string;
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
    id: string;
    customId: string;
    name: string;
    description: string;
    avatarUrl: string;
    expressions: ActorExpressions;
    createdAt: number;
    updatedAt: number;
}

export type Note = {
    id: string;
    title: string;
    type: string;
    content: string;
    createdAt: number;
    updatedAt: number;
}

export type LLMProvider = 'openai' | 'anthropic' | 'google' | 'custom'

export type LLMConfig = {
    id: string;
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
    id: string;
    title: string;
    assets: {
        actors: string[];
        notes: string[];
    };
    createdAt: number;
    updatedAt: number;
}

/** The in-memory, hydrated version of a chat that's been loaded from the database. */
export type CurrentChatState = {
    id: string | null;
    title: string;
    assets: {
        actors: string[];
        notes: string[];
    };
    /** Keyed by message id. Render order is determined by `createdAt`. */
    messages: Record<string, ChatMessage>;
    createdAt: number | null;
    updatedAt: number | null;
}

export type ChatMessage = {
    id: string;
    role: 'user' | 'assistant' | 'system';
    chatId: string;
    content: string;
    createdAt: number;
    updatedAt: number;
    metadata?: Record<string, any>;
}

export type UserChatMessage = ChatMessage & {
    role: 'user';
    /** For preserving what character the user was roleplaying as when they sent this message. */
    actorId?: string;
}
export type UserPreferences = {
    activeLLMConfigId: string | null;
    playerCharacterId: string | null;
    [key: string]: any;
};

export type NewsItem = {
    timestamp: string;
    title: string;
    content: string[];
    tags: string[];
}
