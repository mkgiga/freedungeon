/**
 * State is read-only on the frontend side.
 * All mutations to state must be done through API calls to the backend.
 *
 * All `createdAt` / `updatedAt` fields are Unix timestamps in **milliseconds**
 * (compatible with `Date.now()` and `new Date(ms)`).
 */
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
    /**
     * Readiness of the external files the app fetches on demand (see
     * shared/dependencies.ts). Transient like `activities` — never persisted,
     * and re-verified against the data dir on every boot, so the client always
     * renders the true on-disk state rather than a remembered one.
     */
    dependencies: Partial<Record<DependencyKey, DependencyState>>;
    notifications: AppNotification[];
    userPreferences: UserPreferences;
    /**
     * State owned by extensions (today: built-in features), keyed by extension
     * then by the variable name it declared.
     *
     * A persisted root like `assets`, not a transient one: writes go through
     * setState, so they reach the database and the client by the same path
     * everything else does. Deliberately separate from
     * `userPreferences.features[key].values`, which is *settings* — user-facing,
     * schema-rendered, and rewritten wholesale on every change. This is an
     * extension's own working state and never appears in a settings form.
     */
    extensionState: Record<string, Record<string, unknown>>;
    /**
     * Installed extensions, keyed by id. Rebuilt by scanning the extensions
     * directory at boot, so it is transient like `activities` — the folder on
     * disk is the truth, not this. Whether each is switched on lives in
     * `userPreferences.extensions`, which does persist.
     */
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
        /** Opens the models library on the config currently in use. */
        | 'openLlmConfig'
        /** Opens the Downloads side panel. */
        | 'openDownloads';
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
    /** Fix-it affordance rendered inside the toast. */
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
    /**
     * The Scenario this was authored for, or null for the global library.
     *
     * Purely a *listing* rule: the global library is "things with no home".
     * It does NOT restrict use — a character can be attached to any number of
     * chats via chat_actor_refs regardless of where it lives, which is how
     * importing between Scenarios works. Deleting the home Scenario evicts
     * rather than deletes (FK `ON DELETE SET NULL`), so residents fall back
     * into the global library instead of vanishing.
     */
    homeChatId?: string | null;
    /**
     * Soft-delete tombstone (ms epoch). See the note on Note.deletedAt — the
     * row survives so chat history keeps resolving portraits and expressions.
     */
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
    /**
     * The Scenario this was authored for, or null for the global library.
     *
     * Purely a *listing* rule: the global library is "things with no home".
     * It does NOT restrict use — a character can be attached to any number of
     * chats via chat_actor_refs regardless of where it lives, which is how
     * importing between Scenarios works. Deleting the home Scenario evicts
     * rather than deletes (FK `ON DELETE SET NULL`), so residents fall back
     * into the global library instead of vanishing.
     */
    homeChatId?: string | null;
    /**
     * Soft-delete tombstone (ms epoch). The row is never removed, because chat
     * history resolves actors and notes live — deleting outright would strip
     * portraits and expressions from messages already written. Everything that
     * *presents* a library, picker, or agent tool filters on this; history does
     * not, so old chats keep rendering exactly as they did.
     */
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
    /**
     * What this chat *is*, which selects both the agent that drives it and the
     * contextual UI around it.
     *
     *  - `roleplay`     — the game. Party rail, inventory, game state, blocks.
     *  - `collaborator` — an authoring conversation. No game state; the agent
     *                     edits actors and notes instead of narrating.
     *
     * Absent on chats written before this existed, which are all roleplay.
     */
    kind?: ChatKind;
    /**
     * For a `collaborator` chat: the Scenario it belongs to. Keeps it out of the
     * recent-chats list and scopes its agent to that Scenario's resources.
     *
     * Unlike actors and notes this CASCADEs on delete rather than orphaning —
     * an evicted character is still useful, an authoring conversation without
     * its subject is not.
     */
    homeChatId?: string | null;
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
    /**
     * When the user finished (or skipped) first-run onboarding, as ms epoch.
     * Null/absent means it hasn't happened and the overlay shows.
     *
     * Deliberately an explicit stamp rather than something inferred from
     * "has no LLM configs": a user who deletes every config to start over
     * hasn't become a new user, and shouldn't be onboarded again. The one
     * inference we do make is a single backfill at startup — see
     * backfillOnboarding in server.ts.
     */
    onboardingCompletedAt?: number | null;
    /** Per-feature config keyed by feature key (see shared/features.ts).
     *  Stores only what the user changed; registry defaults are merged on read
     *  via resolveFeatureConfig. */
    features?: Record<string, { enabled: boolean; values: Record<string, unknown> }>;
    /**
     * Settings for the Scenario collaborator, grouped rather than flattened —
     * they belong to one agent, they're edited from that agent's own panel, and
     * keeping them out of the top level stops the Preferences screen and this
     * from competing over the same namespace.
     */
    scenarioAgent?: {
        /** Overrides prompts/SCENARIO_AGENT.md. Absent means "use the shipped
         *  default", so an untouched install keeps tracking edits to that file. */
        systemPrompt?: string;
    };
    /**
     * Keybind overrides by action id (see shared/actions.ts). Only what the
     * user changed is stored; everything else resolves to the registry's
     * default, so a re-bound default travels to existing installs. An explicit
     * `null` means "unbound" and is deliberately distinct from absent.
     */
    keybinds?: Record<string, string | null>;
    /** Which extensions are switched on. Absent means off. */
    extensions?: Record<string, { enabled: boolean }>;
    /** Presentation-only settings, grouped by the surface they affect. Nothing
     *  here reaches the agent or the server's turn logic. */
    interface?: {
        chat?: {
            /** Play narration and dialogue straight through: no typewriter, no
             *  tap to continue. `pause` beats still run — they release
             *  themselves, so they never wait on the user. */
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
