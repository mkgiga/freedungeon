import { bold, brightGreen, ComfyLogger, reset, style, white } from "comfylogger";
import { db, loadChatById, saveChat } from "./db";
import { state, setState, deleteState } from "./server";
import type { ChatMessage, Chat, CurrentChatState } from "@shared/types";
import { nanoid } from "nanoid";
import { ChatCompletionManager } from "./llm";
export const MAX_VISIBLE_MESSAGES = 20;
export const chatLogger = new ComfyLogger({ name: 'chat' });

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
            createdAt: Date.now(),
            updatedAt: Date.now(),
        }

        setState('currentChat', newChat);
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

    static async prompt(message: string) {
        if (!state.currentChat.id) {
            logChat('No active chat. Please create or load a chat before sending a message.');
            throw new Error('No active chat. Please create or load a chat before sending a message.');
        }

        // Guard against multiple simultaneous generations
        if (ChatCompletionManager.isGenerating) {
            logChat('Already generating a response. Please wait for it to finish before sending another message.');
            return;
        }

        const llmConfig = state.assets.llmConfigs[state.userPreferences.activeLLMConfigId!];
        
        if (!llmConfig) {
            logChat('No active LLM config selected. Cannot send message.');
            return;
        }
        
        const upsertResult = CurrentChat.upsertMessage({
            id: nanoid(),
            role: 'user' as const,
            content: message,
            chatId: state.currentChat.id,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            metadata: {
                // what actor the user was playing as when they sent this message, if any
                // might be used for context later
                actorId: state.userPreferences.playerCharacterId,
            }
        });

        if (!upsertResult) {
            logChat('Failed to add user message to chat history.');
            throw new Error('Failed to add user message to chat history.');
        }
        

        const allMessages = Object.values(state.currentChat.messages);
        const sortedMessages = allMessages.sort((a, b) => a.createdAt - b.createdAt);
        const systemPrompt = state.assets.llmConfigs[state.userPreferences.activeLLMConfigId!]?.values?.systemPrompt ?? '';
        if (!systemPrompt) {
            logChat('No system prompt found in active LLM config. This may lead to unhelpful responses.');
            throw new Error('No system prompt found in active LLM config. This may lead to unhelpful responses.');
        }
        
        const debugFetchResultData = await ChatCompletionManager.chatCompletion({
            history: sortedMessages.map(m => ({ role: m.role, content: m.content })),
            systemPrompt,
            onComplete: (response) => {
                if (!state.currentChat.id) {
                    logChat('No active chat. Cannot add assistant response to chat history.');
                    throw new Error('No active chat. Cannot add assistant response to chat history.');
                }

                CurrentChat.upsertMessage({
                    id: nanoid(),
                    role: 'assistant',
                    chatId: state.currentChat.id,
                    content: response,
                    createdAt: Date.now(),
                    updatedAt: Date.now(),
                });
            },
        });

        console.log('(DEBUG) Fetch data:', debugFetchResultData);
    }
}