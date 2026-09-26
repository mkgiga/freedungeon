import type { ExtensionManifest } from '@shared/extensions'
import type { ExtensionEventName, ExtensionEvents } from '@shared/extension-events'
import type { SchemaField } from '@shared/schema-ui'
import type { Block } from '@shared/blocks'
import type { CommandName } from '@shared/game-state/commands'
import type { AppState, ChatMessage } from '@shared/types'
import type { ExtensionStore } from '../extension-state'

/**
 * What an extension is handed when it activates.
 *
 * Injected rather than imported: extensions load from disk at runtime, so a
 * bare `from 'freedungeon'` would need a module resolver or an installed
 * package. Types come from the shipped `freedungeon.d.ts`, so autocomplete
 * still works - types by declaration, runtime by injection.
 *
 * This is the app's own machinery, handed over rather than imitated:
 * `app.update` is the same draft write the server uses on itself, `game.exec`
 * is the path the agent's tool calls take, `blocks` is the message format the
 * chat actually renders, and `activity` is the spinner the app already draws.
 * An extension that does a thing does it the way freedungeon does it, so its
 * writes persist, replicate and undo like everything else.
 *
 * The host does not manage an extension's life for it. Everything is
 * registered from inside `activate`, every registration hands back the call
 * that undoes it, and the whole lot is unwound on disable.
 */
export type FreedungeonHost = {
    readonly id: string
    readonly manifest: Readonly<ExtensionManifest>

    /** This extension's own persisted, replicated bag. Nobody else writes it. */
    readonly state: ExtensionStore

    readonly settings: ExtensionSettings
    readonly app: AppApi
    readonly chat: ChatApi
    readonly game: GameApi
    readonly blocks: BlocksApi
    readonly activity: ActivityApi
    readonly prompt: PromptApi

    /** Subscribe to a lifecycle hook. Returns the unsubscribe. */
    on<E extends ExtensionEventName>(
        event: E,
        handler: (payload: ExtensionEvents[E]) => void | Promise<void>,
    ): () => void

    /** Answer `fd.call(name, args)` from this extension's browser code. */
    onCall(
        name: string,
        handler: (args: Record<string, unknown>) => unknown | Promise<unknown>,
    ): () => void

    log: (message: string) => void
    warn: (message: string) => void
    error: (message: string) => void

    notify: (opts: { title: string; message: string; kind?: 'info' | 'error' }) => void

    onDispose: (fn: () => void) => void
}

export type ExtensionSettings = {
    /**
     * Declare the settings form. Flat single-element paths: the value
     * namespace is shallow so a field added later merges over stored values
     * without a migration. Each field's `default` *is* the default.
     */
    define(fields: SchemaField[]): void

    readonly values: Record<string, unknown>
    get<T>(name: string, fallback?: T): T

    /**
     * Runs before the change is written, and **throwing refuses it** - nothing
     * is persisted and the error reaches the user. That is how an extension
     * declines a setting it cannot honour yet, such as one whose files are
     * still missing.
     */
    onChange(
        handler: (next: Record<string, unknown>, prev: Record<string, unknown>) => void | Promise<void>,
    ): () => void
}

/**
 * The central read/write surface. `state` is the live server store - the same
 * object the app itself renders from - and `update` is the only way to change
 * it. One `update` call becomes one set of precise patches: each is persisted
 * and pushed to every connected client, so an extension's write shows up in
 * the UI exactly like the app's own.
 */
export type AppApi = {
    readonly state: Readonly<AppState>
    update(fn: (draft: AppState) => void): void
}

/**
 * The chat the app is showing, written the way the app writes it: messages get
 * an id, a chat id and timestamps, and a director note lands in the field the
 * next turn drains.
 */
export type ChatApi = {
    readonly id: string | null
    readonly messages: Readonly<Record<string, ChatMessage>>

    /** Post one message. Its content is serialized blocks - see `blocks`. */
    post(
        content: string | Block[],
        opts?: { role?: ChatMessage['role']; metadata?: Record<string, unknown> },
    ): string | null

    /** Queue an out-of-character note for the next turn's system notice. */
    systemNotice(text: string): void

    /** Send a prompt as the player, exactly as the composer does. */
    prompt(message: string): Promise<void>
}

/**
 * Game state is changed by running a command, never by assigning into
 * `gameState`. It is the same call the agent's tool use lands on, so an
 * extension's `damage` posts the same block, applies the same effects, fires
 * the same `command.executed` hook and replays identically on reload.
 */
export type GameApi = {
    exec(
        command: CommandName,
        args: Record<string, unknown>,
    ): Promise<{ ok?: boolean; messageId?: string; effects?: string; error?: string }>
}

/** The message format. A chat message is serialized blocks, nothing else. */
export type BlocksApi = {
    parse(content: string): Block[]
    serialize(blocks: Block[]): string
}

/**
 * In-flight work, shown the way the app shows its own. `run` is the one to
 * reach for: its `finally` clears the activity even when the work throws, so a
 * failure can't leave a spinner on screen forever.
 */
export type ActivityApi = {
    run<T>(
        kind: string,
        data: Record<string, unknown>,
        fn: (update: (patch: Record<string, unknown>) => void) => Promise<T>,
    ): Promise<T>
    begin(kind: string, data?: Record<string, unknown>): string
    update(id: string, patch: Record<string, unknown>): void
    end(id: string): void
}

export type PromptApi = {
    /**
     * Contribute a block of system prompt. Pulled fresh each turn, so it can
     * read settings and state and return null to sit the turn out.
     */
    section(build: () => string | null | undefined): () => void

    /**
     * Answer a `{{ name }}` macro scope in prompt templates. An unclaimed
     * scope renders verbatim rather than throwing, so a template that names
     * one is safe while its extension is off.
     */
    scope(name: string, build: () => unknown): () => void
}

export type ExtensionModule = {
    activate?: (fd: FreedungeonHost) => void | Promise<void>
    deactivate?: () => void | Promise<void>
}
