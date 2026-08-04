import { bold, brightGreen, ComfyLogger, reset, style, white } from "comfylogger";
import { db, loadChatById, saveChat } from "./db";
import { state, setState, deleteState } from "./server";
import type { ChatMessage, Chat, CurrentChatState } from "@shared/types";
import { nanoid } from "nanoid";
import { runTurn, createInitialContext } from "./game-state";
import { dispatchPromptToAgent, forkAgentSession, forkAgentSessionForChat, invalidateAgentSession, resetFlagsSnapshotToCurrent } from "./agent";
import { notification } from "./notifications";
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
        // The outgoing chat needs no flush — every mutation (messages, chat
        // row, refs) persisted at write time via persistPath.

        // Load the new chat
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

        return currentChat.messages[message.id];
    }

    /** Removes a message from the currently-loaded chat (DB delete via persistPath). */
    static deleteMessage(messageId: string) {
        const currentChat = state.currentChat;
        if (!currentChat.id) {
            logChat(`No chat loaded. Cannot delete message ${messageId}.`);
            throw new Error(`No chat loaded. Cannot delete message ${messageId}.`);
        }
        if (!currentChat.messages[messageId]) return;

        deleteState('currentChat', 'messages', messageId);
    }

    /**
     * Single "generate next assistant turn" primitive used by both `prompt`
     * (normal user-initiated send) and `regenerateMessage` (retry flow).
     *
     * The agent process owns the LLM conversation. We just hand it the chat
     * id and the user message id we want it to respond to; it streams Block
     * emissions back via /agent-rpc which append assistant ChatMessages.
     */
    private static async generateResponse(userMessageId: string, userContent: string) {
        if (!state.currentChat.id) {
            logChat('No active chat. Cannot generate a response.');
            return;
        }

        if (state.isGenerating) {
            logChat('Already generating a response. Please wait for it to finish.');
            return;
        }

        // Game-state recompute happens in dispatchPromptToAgent (which runs
        // immediately below and is the consumer via @GAME_STATE()) — doing it
        // here too would replay the full history twice per prompt.

        // Critical: NEVER let this method's rejection escape. The tRPC
        // mutation that triggers it is fire-and-forget (it doesn't
        // await CurrentChat.prompt), so any rejection here becomes an
        // unhandled rejection — which on Bun means process exit.
        // SDK errors (Overloaded), transport closes, and aborts that
        // don't surface as "AbortError" all reach this point. We
        // catch, surface to the user via notification, and ensure
        // isGenerating is cleared so the UI unfreezes.
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
            });
        } finally {
            // Always clear isGenerating so the UI's Send button
            // re-enables after a failure. The agent's turn_ended
            // RPC clears this on the happy path; the finally covers
            // every other path.
            if (state.isGenerating) {
                setState('isGenerating', false);
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
                // what actor the user was playing as when they sent this message, if any
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
     * Forks the SDK session at the turn-closer anchor of the message just
     * BEFORE the surviving user prompt — so the forked session ends right
     * before that prompt and we re-send it fresh. If no anchor is
     * available (first turn, or no prior turn has been stamped) the
     * session is left intact and we just append a new prompt; the model
     * will see the prior response in context.
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

        const lastUser = CurrentChat.lastUserMessage();
        if (!lastUser) return;

        // Fork before lastUser so the SDK doesn't carry the now-pruned
        // response. The previous-turn closer is the natural anchor —
        // find it by stepping back from the message immediately before
        // lastUser. If nothing before, no fork happens (acceptable: the
        // session stays intact, the prior response is in the model's
        // context when re-prompted).
        const messageBeforeLastUser = CurrentChat.messageImmediatelyBefore(lastUser.id);
        if (messageBeforeLastUser) {
            await forkAgentSession({
                chatId: state.currentChat.id!,
                keepUntilMessageId: messageBeforeLastUser.id,
            });
        } else {
            // Nothing survives before the prompt (e.g. regenerating the very
            // first message): there's no turn boundary to fork at, so reset the
            // agent's memory entirely. The next dispatch rehydrates from the
            // pruned log (just this prompt) instead of resuming the full
            // pre-prune conversation — which is what made regenerate silently
            // "continue" instead of rewinding. Covers both loops (invalidate
            // clears the Claude session AND the AI-SDK transcript).
            await invalidateAgentSession(state.currentChat.id!);
        }

        await CurrentChat.refreshStateAndResetSnapshot();
        await CurrentChat.generateResponse(lastUser.id, lastUser.content);
    }

    /**
     * Rewinds the chat to a specific message: keeps everything up to and including
     * the target, deletes all subsequent messages. No LLM call — the user stops
     * "here" and can resume from this point by sending a new message.
     *
     * Forks the SDK session at the target's turn-closer anchor so the
     * SDK transcript matches the displayed history. If no anchor is
     * available the session is left intact.
     */
    static async rewindToMessage(messageId: string) {
        CurrentChat.pruneFromMessage(messageId, { includeTarget: false });
        await forkAgentSession({
            chatId: state.currentChat.id!,
            keepUntilMessageId: messageId,
        });
        await CurrentChat.refreshStateAndResetSnapshot();
    }

    /**
     * Recompute gameState from current message history and reset the
     * agent flags snapshot to the resulting flags. Called after
     * destructive ops (regen, rewind) that re-replay history so the
     * next prompt's <system_notice> delta uses the post-mutation
     * state as the baseline — otherwise pruned-away flag changes
     * would surface as spurious "removed" / "reverted" deltas.
     */
    private static async refreshStateAndResetSnapshot() {
        if (!state.currentChat.id) return;
        const turnResult = runTurn(Object.values(state.currentChat.messages));
        setState('currentChat', 'gameState', turnResult.ctx);
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
                // Clone note refs (with enabled flags) so the branched chat has
                // its own entries. saveChat writes fresh nanoid() junction rows
                // scoped to newChat.id, so there's no cross-referencing with the
                // source chat's rows.
                notes: Object.fromEntries(
                    Object.entries(state.currentChat.assets.notes).map(([id, v]) => [id, { ...v }])
                ),
                images: [...(state.currentChat.assets.images ?? [])],
            },
            // Branching a template produces a regular chat — you shouldn't need to
            // clear the flag manually when you start a new chat from a template.
            isTemplate: false,
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

        // The branch's agent memory is rebuilt from its sliced messages on the
        // first prompt (rehydration), NOT forked from the source session. A
        // branch slice ends at an arbitrary message (often a turn-starting user
        // prompt), but SDK forks can only land on turn boundaries — so a fork
        // can't match the slice and over-copies the source's memory (the bug
        // where a branch "remembered" events not in its visible history). The
        // new chat starts with no session/transcript, so the next dispatch
        // rehydrates from exactly the displayed slice for whichever provider
        // runs it. (Branch only — clone/template still fully copy below.)

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

    /**
     * Duplicates an entire chat (metadata + asset refs with enabled flags + all
     * messages) with fresh ids. Used by "Save as Template" and "Use Template" flows.
     *
     * Does NOT load the new chat into currentChat — the caller decides whether to.
     * Source can be any chat (not just the currently-loaded one); messages are
     * fetched from the DB via `loadChatById`.
     */
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
                // Refs, not copies: an image is a shared library asset, so a
                // chat made from a template points at the same rows.
                images: [...(sourceMeta.assets.images ?? [])],
            },
            // Presentation carries over too. A Scenario's premise and art are
            // most of what it *is*, so a chat played from one should look like
            // the thing you picked rather than an untitled blank.
            description: sourceMeta.description,
            avatarUrl: sourceMeta.avatarUrl,
            bannerUrl: sourceMeta.bannerUrl,
            isTemplate: asTemplate,
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
                // Preserve original timestamps to maintain ordering.
                createdAt: m.createdAt,
                updatedAt: m.updatedAt,
            };
        }

        saveChat(newChat, newMessages);
        setState('assets', 'chats', newId, newChat);

        // Full copy of the source SDK session so the clone inherits the
        // agent's memory. No anchor needed since we copied every message.
        await forkAgentSessionForChat({
            sourceChatId,
            targetChatId: newId,
            mode: 'fullCopy',
        });

        logChat(`Cloned chat ${sourceChatId} → ${newId} (asTemplate=${asTemplate}, ${Object.keys(newMessages).length} messages).`);
        return newId;
    }
}