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
    /** Whether the server is currently generating an LLM response. */
    isGenerating: boolean;
    notifications: AppNotification[];
    userPreferences: UserPreferences;
}

export type GameStateContext = {
    inventory: Record<string, number>;
    scene: {
        actors: {
            /** Actors present in the current scene — rendered in the prompt string. */
            active: Record<string, ActorGameState>;
            /** Actors that have left the scene — retained so HP persists if reintroduced. */
            offscreen: Record<string, ActorGameState>;
        };
    };
}

export type ActorGameState = {
    hp: number;
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
    /** User-authored instructions prepended to every chat. Cross-provider — not a schema field. */
    systemPrompt: string;
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
    /**
     * Derived game state, recomputed from this chat's messages by the server's
     * game-state executor on every prompt and on chat load. Mirrored into
     * currentChat so clients can render HUD/inventory. Never persisted — it's
     * always reconstructed from message history.
     */
    gameState: GameStateContext;
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
