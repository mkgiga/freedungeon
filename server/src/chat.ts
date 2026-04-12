import { bold, brightGreen, ComfyLogger, reset, style, white } from "comfylogger";
import { db, loadChatById, getMessagesByChatId, dehydrateChatMessage } from "./db";
import { state, setState, deleteState } from "./server";
import type { ChatMessage, Chat, CurrentChatState } from "@shared/types";
import { randomNumberId } from "./utils/random";
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

    static async loadChat(id: number) {
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
            id: randomNumberId(16), // Temporary ID until saved to DB
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
            logChat('No active chat. Cannot add message to chat history.');
            throw new Error('No active chat. Cannot add message to chat history.');
        }

        if (!currentChat.id) {
            logChat('No active chat. Cannot add message to chat history.');
            throw new Error('No active chat. Cannot add message to chat history.');
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
     * Persists the currently-loaded chat's messages to the DB.
     *
     * This is the one function that breaks the "state-only mutations, auto-save
     * handles persistence" pattern. Reason: chat messages only live in memory
     * for the currently-loaded chat (to avoid keeping hundreds of thousands of
     * messages across all chats in RAM). When we swap out `currentChat`, the
     * messages MUST be written to disk first or they're gone.
     */
    static saveCurrentChat() {
        const currentChat = state.currentChat;
        if (!currentChat.id) return;

        // Upsert each in-memory message for this chat
        const messageIds: number[] = [];
        for (const msg of Object.values(currentChat.messages)) {
            messageIds.push(msg.id);
            db.insertInto('chat_messages')
                .values({ id: msg.id, ...dehydrateChatMessage(msg) })
                .onConflict((oc) => oc.column('id').doUpdateSet(dehydrateChatMessage(msg)))
                .execute();
        }

        // Delete any messages in the DB for this chat that are no longer in memory
        // (handles deletions made during the session)
        if (messageIds.length > 0) {
            db.deleteFrom('chat_messages')
                .where('chat_id', '=', currentChat.id)
                .where('id', 'not in', messageIds)
                .execute();
        } else {
            // No messages in memory → clear all DB messages for this chat
            db.deleteFrom('chat_messages')
                .where('chat_id', '=', currentChat.id)
                .execute();
        }
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
            id: randomNumberId(16), // Temporary ID until saved to DB
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
                    id: randomNumberId(16), // Temporary ID until saved to DB
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