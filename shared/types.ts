import type { DependencyKey, DependencyState } from './dependencies'
import type { ExtensionInfo } from './extensions'

export type AppState = {
    assets: {
        actors: Record<string, Actor>;
        notes: Record<string, Note>;
        images: Record<string, ImageAsset>;
        llmConfigs: Record<string, LLMConfig>;
        chats: Record<string, Chat>;
    },
    currentChat: CurrentChatState;
    isGenerating: boolean;
    activities: Record<string, Activity>;
    dependencies: Partial<Record<DependencyKey, DependencyState>>;
    notifications: Record<string, AppNotification>;
    userPreferences: UserPreferences;
    extensionState: Record<string, Record<string, unknown>>;
    extensions: Record<string, ExtensionInfo>;
}

/**
 * One unit of in-flight server work. `kind` selects which UI renders it;
 * `data` carries whatever that renderer needs (progress counters, a preview
 * image, a label). Deliberately loose — an activity's shape is a contract
 * between the server code that emits it and the component that draws it.
 */
export type Activity = {
    id: string;
    kind: string;
    startedAt: number;
    data: Record<string, unknown>;
}

export type ItemDefinition = {
    key: string;
    label: string;
    description?: string;
    visualDescription?: string;
    icon?: string;
}

export type GameStateContext = {
    inventory: Record<string, number>;
    itemDefs: Record<string, ItemDefinition>;
    scene: {
        actors: {
            active: Record<string, ActorGameState>;
            offscreen: Record<string, ActorGameState>;
        };
        location?: string;
    };
    flags: Record<string, FlagValue>;
}

export type FlagValue = string | number | boolean;

export type ActorGameState = {
    hp: number;
}

/**
 * A way out of the problem a notification reports, offered alongside it.
 *
 * `kind` is a closed set the client maps to a handler rather than anything the
 * server can describe directly — a notification crosses a socket, so it can
 * carry data but never behaviour. Deliberately no payload: each kind resolves
 * its own target from client state, so the server can't hand over a stale id.
 */
export type NotificationAction = {
    label: string;
    kind:
        | 'openLlmConfig'
        /** Opens the Downloads side panel. */
        | 'openDownloads';
}

export type AppNotification = {
    id: string;
    title: string;
    content: string;
    backgroundColor: string;
    show: boolean;
    toast?: boolean;
    push: boolean;
    textColor: string;
    createdAt: number;
    action?: NotificationAction;
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
    homeChatId?: string | null;
    deletedAt?: number | null;
    createdAt: number;
    updatedAt: number;
}

export type Note = {
    id: string;
    title: string;
    type: string;
    content: string;
    emoji?: string;
    homeChatId?: string | null;
    deletedAt?: number | null;
    createdAt: number;
    updatedAt: number;
}

export type ChatKind = 'roleplay' | 'collaborator';

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

/**
 * A user-curated image attached to a chat (usually a template, as preset
 * scenery the agent can bring on screen by `key`).
 *
 * Agent-generated images deliberately never land here: they're contextual to
 * the beat that produced them, and a registry row would outlive the message
 * block that rewinding or regenerating deletes — leaving an image the agent
 * could still summon for a scene that no longer happened. Those stay as a URL
 * inside their image block and die with it.
 */
export type ImageAsset = {
    id: string;
    key: string;
    label: string;
    url: string;
    createdAt: number;
    updatedAt: number;
}

export type Chat = {
    id: string;
    title: string;
    assets: {
        actors: string[];
        notes: Record<string, { enabled: boolean }>;
        images: string[];
    };
    isTemplate: boolean;
    kind?: ChatKind;
    homeChatId?: string | null;
    avatarUrl?: string;
    bannerUrl?: string;
    description?: string;
    createdAt: number;
    updatedAt: number;
}

/** The in-memory, hydrated version of a chat that's been loaded from the database. */
export type CurrentChatState = {
    id: string | null;
    title: string;
    assets: {
        actors: string[];
        notes: Record<string, { enabled: boolean }>;
        images: string[];
    };
    messages: Record<string, ChatMessage>;
    gameState: GameStateContext;
    agentRehydration: null | {
        messageCount: number;
        estimatedTokens: number;
    };
    pendingSystemNotice: string;
    lastPrompt?: LastPrompt | null;
    createdAt: number | null;
    updatedAt: number | null;
}

export type LastPromptMessage = { role: string; content: string };

export type LastPrompt = {
    capturedAt: number;
    provider: string;
    model: string;
    loop: 'claude' | 'ai-sdk';
    systemPrompt: string;
    messages: LastPromptMessage[];
    rehydratedFromLog: boolean;
    resumedSessionId: string | null;
};

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
    actorId?: string;
}
export type UserPreferences = {
    activeLLMConfigId: string | null;
    playerCharacterId: string | null;
    enableChoicePrompts?: boolean;
    debug?: boolean;
    onboardingCompletedAt?: number | null;
    notificationsSeenAt?: number;
    features?: Record<string, { enabled: boolean; values: Record<string, unknown> }>;
    scenarioAgent?: {
        systemPrompt?: string;
    };
    keybinds?: Record<string, string | null>;
    extensions?: Record<string, { enabled: boolean }>;
    interface?: {
        chat?: {
            autoSkip?: boolean;
        };
    };
    [key: string]: any;
};

export type NewsItem = {
    timestamp: string;
    title: string;
    content: string[];
    tags: string[];
}
