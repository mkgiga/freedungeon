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
        images: Record<string, ImageAsset>;
        llmConfigs: Record<string, LLMConfig>;
        chats: Record<string, Chat>;
    },
    currentChat: CurrentChatState;
    /** Whether the server is currently generating an LLM response. */
    isGenerating: boolean;
    /**
     * In-flight server work the UI can render context-specific affordances for.
     * Purely transient: never persisted (`persistPath` ignores this root), and
     * rebuilt from nothing on restart — a server crash mid-activity leaves no
     * residue because the map starts empty.
     *
     * Keyed by a generated id rather than by `kind` so two activities of the
     * same kind can run concurrently (parallel tool calls, sub-agent
     * workflows) without clobbering each other. Consumers filter by `kind`.
     */
    activities: Record<string, Activity>;
    notifications: AppNotification[];
    userPreferences: UserPreferences;
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
    /** ms epoch, so the UI can show elapsed time or delay a spinner. */
    startedAt: number;
    data: Record<string, unknown>;
}

export type ItemDefinition = {
    key: string;
    label: string;
    description?: string;
    /**
     * Long-form appearance, written for the image model rather than the player:
     * it is the icon prompt, and nothing renders it. Optional because chats
     * predating the field replay without one — icon generation falls back to
     * `description` then.
     */
    visualDescription?: string;
    /** Generated icon URL under /uploads. Absent when image gen is off or failed. */
    icon?: string;
}

export type GameStateContext = {
    /**
     * Quantities keyed by item definition `key`. Chats written before item
     * definitions existed are keyed by free-text display name instead; both
     * resolve through the same lookup, and an entry with no matching
     * definition falls back to rendering its key as the label.
     */
    inventory: Record<string, number>;
    /**
     * Item definitions keyed by `key`, built by replaying defineItem blocks.
     * Like the rest of ctx this is never persisted directly — it is
     * reconstructed from message history.
     */
    itemDefs: Record<string, ItemDefinition>;
    scene: {
        actors: {
            /** Actors present in the current scene — rendered in the prompt string. */
            active: Record<string, ActorGameState>;
            /** Actors that have left the scene — retained so HP persists if reintroduced. */
            offscreen: Record<string, ActorGameState>;
        };
        /** Free-form short description of where the focus is, set by setLocation. */
        location?: string;
    };
    /**
     * Agent-managed key/value scratchpad. Use for boolean conditions
     * ("dragon_defeated"), strings ("current_chapter"), or numeric counters
     * where keying is enough. Reconstructed from message history like the rest
     * of ctx — never persisted directly.
     */
    flags: Record<string, FlagValue>;
}

export type FlagValue = string | number | boolean;

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
    /**
     * Optional user-authored category label. Used to bucket actors in the
     * character list and as additional search text in pickers. Compared
     * case-insensitively when grouping.
     */
    group?: string;
    createdAt: number;
    updatedAt: number;
}

export type Note = {
    id: string;
    title: string;
    type: string;
    content: string;
    emoji?: string;
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
    /** Stable agent-facing identifier, snake_case — how show_image refers to it. */
    key: string;
    /** Human-readable label, shown in the editor and listed to the agent. */
    label: string;
    /** Serving URL under /uploads. */
    url: string;
    createdAt: number;
    updatedAt: number;
}

export type Chat = {
    id: string;
    title: string;
    assets: {
        actors: string[];
        /**
         * Attached notes keyed by note id. `enabled: false` suppresses the
         * note from prompts without detaching it from the chat.
         */
        notes: Record<string, { enabled: boolean }>;
        /** Ids of the images attached to this chat, in display order. */
        images: string[];
    };
    /** When true, this chat is a reusable template. Templates are filtered out
     *  of the regular chat list and shown in a separate "Templates" tab. */
    isTemplate: boolean;
    /** Small avatar image shown in the chat list's leading column. */
    avatarUrl?: string;
    /** Banner image shown at the top of the chat detail view and as a
     *  right-anchored gradient background on each chat list row. */
    bannerUrl?: string;
    /** Free-form description shown only in the chat detail view. */
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
        /**
         * Attached notes keyed by note id. `enabled: false` suppresses the
         * note from `{{ NOTES() }}` macro output without detaching it.
         */
        notes: Record<string, { enabled: boolean }>;
        /** Ids of the images attached to this chat, in display order. */
        images: string[];
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
    /**
     * Non-null when the chat has prior messages but no SDK session — the
     * next prompt will rebuild the agent's memory by injecting the full
     * chat history as a context preamble. Carries stats (message count
     * + estimated tokens) so the UI can warn before the user spends the
     * one-time cost. Cleared back to null on session_captured.
     */
    agentRehydration: null | {
        messageCount: number;
        /** Approximate, char-based (chars / 4). Good enough for a warning. */
        estimatedTokens: number;
    };
    /**
     * One-shot director's note attached to the next agent turn as part of
     * the `<system_notice>` block. Lets the user nudge or correct the agent
     * out-of-character without the input being framed as their dialogue.
     * Cleared by the server after the next prompt dispatch.
     */
    pendingSystemNotice: string;
    /**
     * Debug-only snapshot of the exact prompt last dispatched to the provider,
     * captured server-side only when `userPreferences.debug` is on. In-memory /
     * synced, never persisted — resets on chat switch. Lets the UI show what the
     * model actually saw, which can diverge from the visible chat on
     * regenerate/rewind/branch.
     */
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
    /** True when history was rebuilt from the ChatMessage log (first turn /
     *  provider switch / branch) rather than resumed from the loop's own memory. */
    rehydratedFromLog: boolean;
    /** Claude only: the session id resumed from; null on the AI-SDK path or when
     *  rehydrating from the log. */
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
    /** For preserving what character the user was roleplaying as when they sent this message. */
    actorId?: string;
}
export type UserPreferences = {
    activeLLMConfigId: string | null;
    playerCharacterId: string | null;
    /** When true, the agent is offered the `choice_prompt` tool and may end a
     *  turn with a multiple-choice menu. */
    enableChoicePrompts?: boolean;
    /** When true, the chat UI exposes a button to inspect the exact prompt last
     *  dispatched to the provider (see CurrentChatState.lastPrompt). Dev-only. */
    debug?: boolean;
    /** Per-feature config keyed by feature key (see shared/features.ts).
     *  Stores only what the user changed; registry defaults are merged on read
     *  via resolveFeatureConfig. */
    features?: Record<string, { enabled: boolean; values: Record<string, unknown> }>;
    [key: string]: any;
};

export type NewsItem = {
    timestamp: string;
    title: string;
    content: string[];
    tags: string[];
}
