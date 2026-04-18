import { bold, brightGreen, ComfyLogger, reset, style, white } from "comfylogger";
import { db, loadChatById, saveChat, saveMessage } from "./db";
import { state, setState, deleteState } from "./server";
import type { ChatMessage, Chat, CurrentChatState } from "@shared/types";
import { nanoid } from "nanoid";
import { ChatCompletionManager } from "./llm";
import { parseMacros } from "./macro";
import { runTurn, setCurrentTurnResult, buildHistoryForLLM } from "./game-state";
import { createInitialContext } from "./game-state/scope";
import { writeDebug, writeDebugMd, formatRequestAsText } from "./game-state/debug";
export const MAX_VISIBLE_MESSAGES = 20;
export const chatLogger = new ComfyLogger({ name: 'chat' });

async function countChatMessages(chatId: string): Promise<number> {
    const row = await db.selectFrom('chat_messages')
        .select(db.fn.count<number>('id').as('count'))
        .where('chat_id', '=', chatId)
        .executeTakeFirst();
    return Number(row?.count ?? 0);
}

export const chatLoggerStyle = style((text) => {
    return brightGreen(bold(`[Chat] \x1b[0m${white(text)}`));
});

export const logChat = (message: string) => {
    chatLogger.log(chatLoggerStyle(message));
};

export class CurrentChat {
    static async loadChat(id: string) {
        // 1. Save the currently-loaded chat's messages to the DB before replacing.
        //    Chat messages are the one thing that doesn't live in memory across chats,
        //    so they MUST be persisted immediately or they'd be lost when we swap.
        if (state.currentChat.id) {
            CurrentChat.saveCurrentChat();
        }

        // 2. Load the new chat
        const loadedChat = await loadChatById(id);
        if (loadedChat) {
            setState('currentChat', loadedChat);
            const refreshed = runTurn(Object.values(loadedChat.messages));
            setState('currentChat', 'gameState', refreshed.ctx);
        } else {
            logChat(`Failed to load chat with id ${id}`);
            throw new Error(`Failed to load chat with id ${id}`);
        }
    }

    static newChat({ title }: { title: string; }) {
        const newChat: CurrentChatState = {
            id: nanoid(),
            title,
            assets: {
                actors: [],
                notes: [],
            },
            messages: {},
            gameState: createInitialContext(),
            createdAt: Date.now(),
            updatedAt: Date.now(),
        }

        setState('currentChat', newChat);
    }

    static getMessage(id: string) {
        return state.currentChat.messages[id];
    }

    static upsertMessage(message: ChatMessage) {
        const currentChat = state.currentChat;
        if (!currentChat) {
            logChat(`No chat loaded. Cannot upsert message. Message: ${JSON.stringify(message)}`);
            throw new Error(`No chat loaded. Cannot upsert message. Message: ${JSON.stringify(message)}`);
        }

        if (!currentChat.id) {
            logChat(`currentChat has no id. Value: ${JSON.stringify(currentChat)}`);
            throw new Error(`currentChat has no id. Value: ${JSON.stringify(currentChat)}`);
        }

        if (currentChat.messages[message.id]) {
            setState('currentChat', 'messages', message.id, {
                ...currentChat.messages[message.id],
                ...message,
            });
        } else {
            setState('currentChat', 'messages', message.id, message);
        }

        saveMessage(currentChat.messages[message.id]!);
        return currentChat.messages[message.id];
    }

    /**
     * Removes a message from the currently-loaded chat, in memory and in the DB.
     *
     * Both writes happen here (rather than state-only + auto-save) because message
     * deletions need to propagate immediately — otherwise a restart or chat swap
     * between delete and next save could resurrect the message from disk.
     */
    static deleteMessage(messageId: string) {
        const currentChat = state.currentChat;
        if (!currentChat.id) {
            logChat(`No chat loaded. Cannot delete message ${messageId}.`);
            throw new Error(`No chat loaded. Cannot delete message ${messageId}.`);
        }
        if (!currentChat.messages[messageId]) return;

        deleteState('currentChat', 'messages', messageId);
        db.deleteFrom('chat_messages').where('id', '=', messageId).execute();
    }

    /**
     * Persists the currently-loaded chat (row, refs, and messages) to the DB.
     *
     * Called on chat swap and shutdown — chat messages only live in memory for
     * the currently-loaded chat (to avoid keeping hundreds of thousands of
     * messages across all chats in RAM), so they MUST be written to disk before
     * `currentChat` is replaced or they're gone.
     *
     * Message deletions are handled immediately at their call site in
     * `deleteMessage`; this function only upserts.
     */
    static saveCurrentChat() {
        const currentChat = state.currentChat;
        if (!currentChat.id) return;
        const chat = state.assets.chats[currentChat.id];
        if (!chat) return;
        saveChat(chat, currentChat.messages);
    }

    /**
     * Single "generate next assistant turn" primitive used by both `prompt`
     * (normal user-initiated send) and `regenerateMessage` (retry flow).
     *
     * Reads the current chat's messages as the history — callers are responsible
     * for having the in-memory state in the shape they want to send to the LLM
     * (appending, pruning, etc.) before invoking this.
     */
    private static async generateResponse() {
        if (!state.currentChat.id) {
            logChat('No active chat. Cannot generate a response.');
            throw new Error('No active chat. Cannot generate a response.');
        }

        if (ChatCompletionManager.isGenerating) {
            logChat('Already generating a response. Please wait for it to finish.');
            return;
        }

        const llmConfig = state.assets.llmConfigs[state.userPreferences.activeLLMConfigId!];
        if (!llmConfig) {
            logChat('No active LLM config selected. Cannot generate a response.');
            return;
        }

        const rawMessages = Object.values(state.currentChat.messages);

        // Run the deterministic game-state turn: replay every message's function
        // calls from a fresh initial ctx, collect per-message effect strings,
        // and produce the transient prompt-injection strings.
        const turnResult = runTurn(rawMessages);

        // Mirror ctx into currentChat so clients receive it over socket.io
        // for HUD/inventory rendering. Never persisted to the DB — it's
        // always reconstructed from chat messages.
        setState('currentChat', 'gameState', turnResult.ctx);

        // Expose the turn result to the GAME_STATE macro for the duration of
        // this prompt build.
        setCurrentTurnResult(turnResult);

        try {
            let systemPrompt = llmConfig.systemPrompt ?? '';
            if (!systemPrompt) {
                logChat('No system prompt set. Proceeding with empty system prompt — model behavior may drift.');
            }
            systemPrompt = parseMacros(systemPrompt);
            console.log('Parsed system prompt:', systemPrompt);

            const history = buildHistoryForLLM(rawMessages, turnResult);

            {
                const requestDump = {
                    systemPrompt,
                    history,
                    llmConfig: {
                        name: llmConfig.name,
                        provider: llmConfig.provider,
                        model: llmConfig.model,
                    },
                };
                writeDebugMd('chat-completion-request', formatRequestAsText(requestDump));
            }

            const chatId = state.currentChat.id;
            const debugFetchResultData = await ChatCompletionManager.chatCompletion({
                history,
                systemPrompt,
                onComplete: (response) => {
                    if (!state.currentChat.id) {
                        logChat('No active chat. Cannot add assistant response to chat history.');
                        return;
                    }
                    CurrentChat.upsertMessage({
                        id: nanoid(),
                        role: 'assistant',
                        chatId,
                        content: response,
                        createdAt: Date.now(),
                        updatedAt: Date.now(),
                    });

                    // Recompute the turn over the now-augmented message list so
                    // the client HUD reflects any game-state effects the
                    // assistant's response just produced.
                    const postResponseTurn = runTurn(Object.values(state.currentChat.messages));
                    setState('currentChat', 'gameState', postResponseTurn.ctx);

                    writeDebugMd('chat-completion-response', response);
                    writeDebug('game-state', {
                        ctx: postResponseTurn.ctx,
                        messageResults: postResponseTurn.messageResults,
                        systemPromptGameState: postResponseTurn.systemPromptGameState,
                        mostRecentUserMessageState: postResponseTurn.mostRecentUserMessageState,
                    });
                },
            });

            console.log('(DEBUG) Fetch data:', debugFetchResultData);
        } finally {
            setCurrentTurnResult(null);
        }
    }

    static async prompt({ message }: { message: string }) {
        logChat(`User: ${message}`);

        if (!state.currentChat.id) {
            logChat('No active chat. Please create or load a chat before sending a message.');
            throw new Error('No active chat. Please create or load a chat before sending a message.');
        }

        CurrentChat.upsertMessage({
            id: nanoid(),
            role: 'user' as const,
            content: message,
            chatId: state.currentChat.id,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            metadata: {
                // what actor the user was playing as when they sent this message, if any
                actorId: state.userPreferences.playerCharacterId,
            }
        });

        await CurrentChat.generateResponse();
    }
    
    static editMessage({ messageId, newContent }: { messageId: string; newContent: string }) {
        
        const targetMessage = CurrentChat.getMessage(messageId);

        if (!targetMessage) {
            logChat(`Message with id ${messageId} not found. Cannot edit.`);
            throw new Error(`Message with id ${messageId} not found. Cannot edit.`);
        }

        logChat(`Editing message with id ${messageId}. New content: ${newContent}`);

        CurrentChat.upsertMessage({
            ...targetMessage,
            content: newContent,
            updatedAt: Date.now(),
        });
    }

    static buildHistoryBeforeMessage(messageId: string, includeTarget = false): ChatMessage[] {
        const currentChat = state.currentChat;
        const targetMessage = currentChat.messages[messageId];

        if (!targetMessage) {
            logChat(`Message with id ${messageId} not found. Cannot build history.`);
            throw new Error(`Message with id ${messageId} not found. Cannot build history.`);
        }

        const allMessages = Object.values(currentChat.messages);
        const sortedMessages = allMessages.sort((a, b) => a.createdAt - b.createdAt);
        const targetIndex = sortedMessages.findIndex(msg => msg.id === messageId);

        if (targetIndex === -1) {
            logChat(`Message with id ${messageId} not found in sorted messages. Cannot build history.`);
            throw new Error(`Message with id ${messageId} not found in sorted messages. Cannot build history.`);
        }

        const sliceEnd = targetIndex + (includeTarget ? 1 : 0);
        logChat(`[HISTORY] target=${messageId} includeTarget=${includeTarget} total=${sortedMessages.length} targetIndex=${targetIndex} sliceLength=${sliceEnd}`);
        for (let i = 0; i < sortedMessages.length; i++) {
            const m = sortedMessages[i]!;
            const marker = i === targetIndex ? ' <-- TARGET' : '';
            const preview = m.content.slice(0, 40).replace(/\s+/g, ' ');
            logChat(`[HISTORY]   [${i}] ${m.id} createdAt=${m.createdAt} role=${m.role} "${preview}"${marker}`);
        }

        return sortedMessages.slice(0, sliceEnd);
    }

    /**
     * Deletes messages from a target forward to the end of the chat. Shared by
     * `regenerateMessage` (prune + re-prompt) and `rewindToMessage` (prune only).
     *
     * `includeTarget` controls whether the target itself is also deleted:
     *   - true  → target + all messages after it are deleted
     *   - false → only messages strictly after the target are deleted
     */
    static pruneFromMessage(messageId: string, { includeTarget }: { includeTarget: boolean }) {
        const targetMessage = CurrentChat.getMessage(messageId);
        if (!targetMessage) {
            logChat(`Message with id ${messageId} not found. Cannot prune.`);
            throw new Error(`Message with id ${messageId} not found. Cannot prune.`);
        }

        const sorted = Object.values(state.currentChat.messages)
            .sort((a, b) => (a.createdAt - b.createdAt) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
        const targetIdx = sorted.findIndex(m => m.id === messageId);
        if (targetIdx === -1) return;

        const dropFrom = includeTarget ? targetIdx : targetIdx + 1;
        for (const msg of sorted.slice(dropFrom)) {
            CurrentChat.deleteMessage(msg.id);
        }
    }

    /**
     * Regenerates the assistant reply that followed (or replaced) a message.
     *
     * Semantics:
     *   - Assistant target: drop it + everything after, then generate from what's left.
     *   - User target: drop everything after (the stale reply + follow-ups), then
     *     generate using history ending in this user turn.
     *
     * Uses the same `generateResponse` primitive as `prompt`.
     */
    static async regenerateMessage(messageId: string) {
        const targetMessage = CurrentChat.getMessage(messageId);
        if (!targetMessage) {
            logChat(`Message with id ${messageId} not found. Cannot regenerate.`);
            throw new Error(`Message with id ${messageId} not found. Cannot regenerate.`);
        }

        CurrentChat.pruneFromMessage(messageId, {
            includeTarget: targetMessage.role === 'assistant',
        });

        await CurrentChat.generateResponse();
    }

    /**
     * Rewinds the chat to a specific message: keeps everything up to and including
     * the target, deletes all subsequent messages. No LLM call — the user stops
     * "here" and can resume from this point by sending a new message.
     */
    static rewindToMessage(messageId: string) {
        CurrentChat.pruneFromMessage(messageId, { includeTarget: false });
    }

    static async branchFromTargetMessage({messageId, newTitle}: {messageId: string, newTitle: string}) {
        const targetMessage = CurrentChat.getMessage(messageId);
        if (!targetMessage) {
            logChat(`Message with id ${messageId} not found. Cannot branch.`);
            throw new Error(`Message with id ${messageId} not found. Cannot branch.`);
        }

        const sourceChatId = state.currentChat.id!;
        const sourceChatTotal = Object.keys(state.currentChat.messages).length;

        const newChat: Chat = {
            id: nanoid(),
            title: `${state.currentChat.title} -> ${newTitle}`,
            assets: {
                actors: [...state.currentChat.assets.actors],
                notes: [...state.currentChat.assets.notes],
            },
            createdAt: Date.now(),
            updatedAt: Date.now(),
        };

        const newChatMessages = CurrentChat.buildHistoryBeforeMessage(messageId, true);
        const newChatMessagesObject = Object.fromEntries(newChatMessages.map((m) => {
            const newId = nanoid();
            const newMessage: ChatMessage = {
                ...m,
                id: newId,
                chatId: newChat.id,
                createdAt: m.createdAt, // preserve original timestamps to maintain order
                updatedAt: m.updatedAt,
            };
            return [newId, newMessage];
        }));

        saveChat(newChat, newChatMessagesObject);
        logChat(`Branched new chat "${newChat.title}" with id ${newChat.id} from message ${messageId}.`);
        logChat(`[BRANCH] Source chat ${sourceChatId} had ${sourceChatTotal} messages; branch slice has ${Object.keys(newChatMessagesObject).length} messages.`);

        const countAfterSave = await countChatMessages(newChat.id);
        const sourceCountAfterSave = await countChatMessages(sourceChatId);
        logChat(`[BRANCH] After saveChat: DB count for new ${newChat.id} = ${countAfterSave}, DB count for source ${sourceChatId} = ${sourceCountAfterSave}`);

        logChat(`[BRANCH] Before loadChat: current chat id = ${state.currentChat.id}, messages count = ${Object.keys(state.currentChat.messages).length}`);
        setState('assets', 'chats', newChat.id, newChat);

        await CurrentChat.loadChat(newChat.id);

        logChat(`[BRANCH] After loadChat: current chat id = ${state.currentChat.id}, messages count = ${Object.keys(state.currentChat.messages).length}`);
        const countAfterLoad = await countChatMessages(newChat.id);
        const sourceCountAfterLoad = await countChatMessages(sourceChatId);
        logChat(`[BRANCH] After loadChat: DB count for new ${newChat.id} = ${countAfterLoad}, DB count for source ${sourceChatId} = ${sourceCountAfterLoad}`);
    }
}