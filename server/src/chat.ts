import { bold, brightGreen, ComfyLogger, reset, style, white } from "comfylogger";
import { db, loadChatById, saveChat } from "./db";
import { mutate, state } from "./server";
import type { ChatMessage, Chat, CurrentChatState } from "@shared/types";
import { nanoid } from "nanoid";
import { runTurn, createInitialContext } from "./game-state";
import { dispatchPromptToAgent, forkAgentSession, forkAgentSessionForChat, invalidateAgentSession, resetFlagsSnapshotToCurrent } from "./agent";
import { ActionableError, notification } from "./notifications";
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

        const loadedChat = await loadChatById(id);
        if (loadedChat) {
            mutate(s => { s.currentChat = loadedChat });
            const refreshed = runTurn(Object.values(loadedChat.messages));
            mutate(s => { s.currentChat.gameState = refreshed.ctx });
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
                notes: {},
                images: [],
            },
            messages: {},
            gameState: createInitialContext(),
            agentRehydration: null,
            pendingSystemNotice: '',
            createdAt: Date.now(),
            updatedAt: Date.now(),
        }

        mutate(s => { s.currentChat = newChat });
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
            mutate(s => { s.currentChat.messages[message.id] = {
                ...currentChat.messages[message.id],
                ...message,
            } });
        } else {
            mutate(s => { s.currentChat.messages[message.id] = message });
        }

        return currentChat.messages[message.id];
    }

    static deleteMessage(messageId: string) {
        const currentChat = state.currentChat;
        if (!currentChat.id) {
            logChat(`No chat loaded. Cannot delete message ${messageId}.`);
            throw new Error(`No chat loaded. Cannot delete message ${messageId}.`);
        }
        if (!currentChat.messages[messageId]) return;

        mutate(s => { delete s.currentChat.messages[messageId] });
    }

    private static async generateResponse(userMessageId: string, userContent: string) {
        if (!state.currentChat.id) {
            logChat('No active chat. Cannot generate a response.');
            return;
        }

        if (state.isGenerating) {
            logChat('Already generating a response. Please wait for it to finish.');
            return;
        }

        try {
            await dispatchPromptToAgent({
                chatId: state.currentChat.id,
                userMessageId,
                userContent,
            });
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            logChat(`Agent dispatch failed: ${msg}`);
            notification({
                title: 'Agent error',
                content: msg.slice(0, 240),
                backgroundColor: '#7a1f1f',
                textColor: '#fff',
                show: true,
                toast: true,
                push: false,
                action: err instanceof ActionableError ? err.action : undefined,
            });
        } finally {
            if (state.isGenerating) {
                mutate(s => { s.isGenerating = false });
            }
        }
    }

    static async prompt({ message }: { message: string }) {
        logChat(`User: ${message}`);

        if (!state.currentChat.id) {
            logChat('No active chat. Please create or load a chat before sending a message.');
            throw new Error('No active chat. Please create or load a chat before sending a message.');
        }

        const userMessageId = nanoid();
        CurrentChat.upsertMessage({
            id: userMessageId,
            role: 'user' as const,
            content: message,
            chatId: state.currentChat.id,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            metadata: {
                actorId: state.userPreferences.playerCharacterId,
            }
        });

        await CurrentChat.generateResponse(userMessageId, message);
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

    static async regenerateMessage(messageId: string) {
        const targetMessage = CurrentChat.getMessage(messageId);
        if (!targetMessage) {
            logChat(`Message with id ${messageId} not found. Cannot regenerate.`);
            throw new Error(`Message with id ${messageId} not found. Cannot regenerate.`);
        }

        CurrentChat.pruneFromMessage(messageId, {
            includeTarget: targetMessage.role === 'assistant',
        });

        const lastUser = CurrentChat.lastUserMessage();
        if (!lastUser) return;

        const messageBeforeLastUser = CurrentChat.messageImmediatelyBefore(lastUser.id);
        if (messageBeforeLastUser) {
            await forkAgentSession({
                chatId: state.currentChat.id!,
                keepUntilMessageId: messageBeforeLastUser.id,
            });
        } else {
            await invalidateAgentSession(state.currentChat.id!);
        }

        await CurrentChat.refreshStateAndResetSnapshot();
        await CurrentChat.generateResponse(lastUser.id, lastUser.content);
    }

    static async rewindToMessage(messageId: string) {
        CurrentChat.pruneFromMessage(messageId, { includeTarget: false });
        await forkAgentSession({
            chatId: state.currentChat.id!,
            keepUntilMessageId: messageId,
        });
        await CurrentChat.refreshStateAndResetSnapshot();
    }

    private static async refreshStateAndResetSnapshot() {
        if (!state.currentChat.id) return;
        const turnResult = runTurn(Object.values(state.currentChat.messages));
        mutate(s => { s.currentChat.gameState = turnResult.ctx });
        await resetFlagsSnapshotToCurrent(state.currentChat.id);
    }

    static messageImmediatelyBefore(messageId: string): ChatMessage | null {
        const sorted = Object.values(state.currentChat.messages)
            .sort((a, b) => (a.createdAt - b.createdAt) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
        const idx = sorted.findIndex(m => m.id === messageId);
        if (idx <= 0) return null;
        return sorted[idx - 1] ?? null;
    }

    static lastUserMessage(): ChatMessage | null {
        const sorted = Object.values(state.currentChat.messages)
            .sort((a, b) => (a.createdAt - b.createdAt) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
        for (let i = sorted.length - 1; i >= 0; i--) {
            if (sorted[i]!.role === 'user') return sorted[i]!;
        }
        return null;
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
                notes: Object.fromEntries(
                    Object.entries(state.currentChat.assets.notes).map(([id, v]) => [id, { ...v }])
                ),
                images: [...(state.currentChat.assets.images ?? [])],
            },
            isTemplate: false,
            kind: 'roleplay' as const,
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
        mutate(s => { s.assets.chats[newChat.id] = newChat });

        await CurrentChat.loadChat(newChat.id);

        logChat(`[BRANCH] After loadChat: current chat id = ${state.currentChat.id}, messages count = ${Object.keys(state.currentChat.messages).length}`);
        const countAfterLoad = await countChatMessages(newChat.id);
        const sourceCountAfterLoad = await countChatMessages(sourceChatId);
        logChat(`[BRANCH] After loadChat: DB count for new ${newChat.id} = ${countAfterLoad}, DB count for source ${sourceChatId} = ${sourceCountAfterLoad}`);
    }

    static async cloneChat(sourceChatId: string, { newTitle, asTemplate }: { newTitle: string, asTemplate: boolean }): Promise<string> {
        const sourceMeta = state.assets.chats[sourceChatId];
        if (!sourceMeta) throw new Error(`Source chat ${sourceChatId} not found`);

        const source = await loadChatById(sourceChatId);
        const newId = nanoid();
        const now = Date.now();

        const newChat: Chat = {
            id: newId,
            title: newTitle,
            assets: {
                actors: [...sourceMeta.assets.actors],
                notes: Object.fromEntries(
                    Object.entries(sourceMeta.assets.notes).map(([id, v]) => [id, { ...v }])
                ),
                images: [...(sourceMeta.assets.images ?? [])],
            },
            description: sourceMeta.description,
            avatarUrl: sourceMeta.avatarUrl,
            bannerUrl: sourceMeta.bannerUrl,
            isTemplate: asTemplate,
            kind: 'roleplay' as const,
            createdAt: now,
            updatedAt: now,
        };

        const newMessages: Record<string, ChatMessage> = {};
        for (const m of Object.values(source.messages)) {
            const msgId = nanoid();
            newMessages[msgId] = {
                ...m,
                id: msgId,
                chatId: newId,
                createdAt: m.createdAt,
                updatedAt: m.updatedAt,
            };
        }

        saveChat(newChat, newMessages);
        mutate(s => { s.assets.chats[newId] = newChat });

        await forkAgentSessionForChat({
            sourceChatId,
            targetChatId: newId,
            mode: 'fullCopy',
        });

        logChat(`Cloned chat ${sourceChatId} → ${newId} (asTemplate=${asTemplate}, ${Object.keys(newMessages).length} messages).`);
        return newId;
    }
}