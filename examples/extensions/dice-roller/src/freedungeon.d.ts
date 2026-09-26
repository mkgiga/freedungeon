/**
 * Types only - the real objects are handed to `activate` at runtime. Copy this
 * next to your source for autocomplete.
 *
 * `FreedungeonHost` is what the server side gets; `FreedungeonClient` is what
 * the browser entry (`content` in the manifest) gets.
 */

export type ExtensionStore = {
    readonly values: Record<string, unknown>
    set(name: string, value: unknown): void
    remove(name: string): void
    update(fn: (draft: Record<string, unknown>) => void): void
}

export type SchemaField = {
    /** One element. The settings namespace is flat. */
    path: [string]
    label: string
    description?: string
    default: unknown
    control:
        | { type: 'toggle' }
        | { type: 'text'; multiline?: boolean; maxLength?: number }
        | { type: 'number'; min?: number; max?: number; step?: number }
        | { type: 'slider'; min: number; max: number; step: number }
        | { type: 'select'; options: { label: string; value: unknown }[] }
        | { type: 'tags'; maxItems?: number }
}

export type ExtensionSettings = {
    define(fields: SchemaField[]): void
    readonly values: Record<string, unknown>
    get<T>(name: string, fallback?: T): T
    /** Throw to refuse the change; nothing is written. */
    onChange(
        handler: (next: Record<string, unknown>, prev: Record<string, unknown>) => void | Promise<void>,
    ): () => void
}

export type Block = { type: string; [key: string]: unknown }

export type ChatMessage = {
    id: string
    role: 'user' | 'assistant' | 'system'
    chatId: string
    content: string
    createdAt: number
    updatedAt: number
    metadata?: Record<string, unknown>
}

/** The whole application state. Read it freely; write it through `app.update`. */
export type AppState = Record<string, any>

export type ExtensionEvents = {
    'app.ready': Record<string, never>
    'app.shutdown': Record<string, never>
    'chat.created': { chatId: string }
    'chat.loaded': { chatId: string }
    'message.created': { chatId: string; message: ChatMessage }
    'message.updated': { chatId: string; message: ChatMessage }
    'message.deleted': { chatId: string; messageId: string }
    'turn.start': { chatId: string; userMessageId: string; userContent: string }
    'turn.end': { chatId: string }
    'command.executed': {
        chatId: string
        command: string
        args: Record<string, unknown>
        messageId: string
        gameState: Record<string, any>
    }
}

export type FreedungeonHost = {
    readonly id: string
    readonly manifest: { id: string; name: string; version: string; description?: string }

    /** Your own persisted, replicated bag. */
    readonly state: ExtensionStore
    readonly settings: ExtensionSettings

    readonly app: {
        readonly state: AppState
        /** Mutate a draft. Immer records the change; it persists and replicates. */
        update(fn: (draft: AppState) => void): void
    }

    readonly chat: {
        readonly id: string | null
        readonly messages: Record<string, ChatMessage>
        post(
            content: string | Block[],
            opts?: { role?: ChatMessage['role']; metadata?: Record<string, unknown> },
        ): string | null
        systemNotice(text: string): void
        prompt(message: string): Promise<void>
    }

    /** Change game state by running a command, the way the agent's tools do. */
    readonly game: {
        exec(
            command: string,
            args: Record<string, unknown>,
        ): Promise<{ ok?: boolean; messageId?: string; effects?: string; error?: string }>
    }

    readonly blocks: {
        parse(content: string): Block[]
        serialize(blocks: Block[]): string
    }

    readonly activity: {
        run<T>(
            kind: string,
            data: Record<string, unknown>,
            fn: (update: (patch: Record<string, unknown>) => void) => Promise<T>,
        ): Promise<T>
        begin(kind: string, data?: Record<string, unknown>): string
        update(id: string, patch: Record<string, unknown>): void
        end(id: string): void
    }

    readonly prompt: {
        /** Pulled fresh each turn. Return null to sit this one out. */
        section(build: () => string | null | undefined): () => void
        /** Answer a `{{ name }}` macro scope in prompt templates. */
        scope(name: string, build: () => unknown): () => void
    }

    on<E extends keyof ExtensionEvents>(
        event: E,
        handler: (payload: ExtensionEvents[E]) => void | Promise<void>,
    ): () => void

    /** Answer `fd.call(name, args)` from your browser code. */
    onCall(
        name: string,
        handler: (args: Record<string, unknown>) => unknown | Promise<unknown>,
    ): () => void

    log(message: string): void
    warn(message: string): void
    error(message: string): void
    notify(opts: { title: string; message: string; kind?: 'info' | 'error' }): void
    onDispose(fn: () => void): void
}

export type UiSlot =
    | 'app.leftNav'
    | 'app.overlay'
    | 'chat.hud'
    | 'chat.sidebar'
    | 'settings.extension'

export type SlotMount = (
    el: HTMLElement,
    ctx: { readonly slot: UiSlot; readonly settings: Record<string, unknown> },
) => void | (() => void)

export type FreedungeonClient = {
    readonly id: string
    readonly manifest: { id: string; name: string; version: string; description?: string }

    /** Live application state. Read-only here; the browser never writes state. */
    readonly state: AppState
    readonly settings: {
        readonly values: Record<string, unknown>
        get<T>(name: string, fallback?: T): T
    }

    ui: {
        /** Draw into one of the app's slots. Returns the call that removes it. */
        slot(slot: UiSlot, mount: SlotMount): () => void
    }

    /** Reach your own server side. Answered by `fd.onCall` there. */
    call(name: string, args?: Record<string, unknown>): Promise<unknown>

    /** Re-run `react` whenever `read` returns something new. */
    watch<T>(read: () => T, react: (value: T) => void): () => void

    log(message: string): void
    warn(message: string): void
    error(message: string): void
    onDispose(fn: () => void): void
}
