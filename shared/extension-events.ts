import type { ChatMessage, GameStateContext } from './types'

/**
 * What the app announces. Hooks are observers, never interceptors: the app
 * does not wait on a handler and does not read its return value, so a slow or
 * throwing extension cannot stall or alter a turn. An extension that wants to
 * contribute to a turn does so through the pull-based surfaces
 * (`fd.prompt.section`, `fd.prompt.scope`) instead.
 */
export type ExtensionEvents = {
    /** Every extension is loaded and the server is listening. */
    'app.ready': Record<string, never>
    /** Sent on SIGINT/SIGTERM, synchronously, just before exit. */
    'app.shutdown': Record<string, never>

    'chat.created': { chatId: string }
    'chat.loaded': { chatId: string }

    'message.created': { chatId: string; message: ChatMessage }
    'message.updated': { chatId: string; message: ChatMessage }
    'message.deleted': { chatId: string; messageId: string }

    'turn.start': { chatId: string; userMessageId: string; userContent: string }
    'turn.end': { chatId: string }

    /** One agent tool call, after its effects landed in game state. */
    'command.executed': {
        chatId: string
        command: string
        args: Record<string, unknown>
        messageId: string
        gameState: GameStateContext
    }
}

export type ExtensionEventName = keyof ExtensionEvents
