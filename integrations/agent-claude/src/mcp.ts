import { tool, createSdkMcpServer, type SdkMcpToolDefinition } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { COMMANDS, commandSchema, type CommandName } from '@shared/game-state/commands';
import { QUERIES } from '@shared/game-state/queries';
import { rpcExec, rpcQuery } from './rpc';
import { getActiveChatId, getCurrentSdkAssistantUuid, requestEndTurn, recordProducedMessageId } from './bridge-state';

/**
 * Build the MCP server for one user prompt. The chatId is closed over by the
 * tool handlers, so we get a fresh server per prompt — that keeps the tool
 * handlers' notion of "current chat" unambiguous even if the user switches
 * chats mid-turn (which we don't allow, but the closure makes it impossible
 * to act on the wrong chat by accident).
 *
 * Tool naming: MCP names become `mcp__game_state__<tool>` once the server is
 * registered under `game_state`. We pass that pattern to `allowedTools` so
 * the model can call them without permission prompts.
 */
export function buildGameStateMcpServer(enableChoicePrompts: boolean, enableSceneImages = false, enableItemIcons = false) {
    const writeTools = commandEntries(enableSceneImages).map(([key, spec]) => {
        const shape = unwrapToShape(commandSchema(key as CommandName, { itemIcons: enableItemIcons }));
        return tool(
            spec.name,
            spec.description,
            shape,
            async (args) => {
                const chatId = getActiveChatId();
                if (!chatId) {
                    return {
                        content: [{ type: 'text', text: 'Error: no active chat — agent state is broken.' }],
                        isError: true,
                    };
                }
                const sdkUuid = getCurrentSdkAssistantUuid();
                const result = await rpcExec(chatId, key, args as Record<string, unknown>, sdkUuid);
                if ('error' in result) {
                    return {
                        content: [{ type: 'text', text: `Tool error: ${result.error}` }],
                        isError: true,
                    };
                }
                recordProducedMessageId(result.messageId);
                return {
                    content: [{ type: 'text', text: result.effects }],
                };
            },
            spec.destructive ? { annotations: { destructiveHint: true } } : undefined
        );
    });

    const readTools = Object.entries(QUERIES).map(([key, spec]) => {
        const shape = unwrapToShape(spec.schema);
        return tool(
            spec.name,
            spec.description,
            shape,
            async (args) => {
                const chatId = getActiveChatId();
                if (!chatId) {
                    return {
                        content: [{ type: 'text', text: 'Error: no active chat — agent state is broken.' }],
                        isError: true,
                    };
                }
                const result = await rpcQuery(chatId, key, args as Record<string, unknown>);
                if ('error' in result) {
                    return {
                        content: [{ type: 'text', text: `Query error: ${result.error}` }],
                        isError: true,
                    };
                }
                return {
                    content: [{ type: 'text', text: result.result }],
                };
            },
            { annotations: { readOnlyHint: true } }
        );
    });

    const endTurnBase = 'Call this when the causal chain initiated by the user\'s prompt is fully resolved and you have nothing more to do. After end_turn, the conversation hands control back to the user.';
    const endTurnDescription = enableChoicePrompts
        ? `${endTurnBase} You may optionally pass \`choices\`: an enumerated set of 2+ candidate next actions salient to the focus actor at this branch point. The focus actor's controller may take one — it returns next tick as \`choice("...")\` — or disregard the set and supply any other action via \`unformatted(...)\`. Enumerate only when the branch genuinely narrows to a few distinct, material actions; otherwise leave the next move open.`
        : endTurnBase;
    const endTurnShape: z.ZodRawShape = enableChoicePrompts
        ? { choices: z.array(z.string()).min(2).optional().describe('2+ candidate next actions for the focus actor, each phrased as an action the focus actor takes, present tense.') }
        : {};
    const endTurn = tool(
        'end_turn',
        endTurnDescription,
        endTurnShape,
        async (args) => {
            const choices = enableChoicePrompts ? (args as { choices?: string[] }).choices : undefined;
            if (choices && choices.length > 0) {
                const chatId = getActiveChatId();
                if (chatId) {
                    const sdkUuid = getCurrentSdkAssistantUuid();
                    const result = await rpcExec(chatId, 'choice_prompt', { options: choices }, sdkUuid);
                    if (!('error' in result)) recordProducedMessageId(result.messageId);
                    // On error we still end the turn — the menu just won't persist.
                }
            }
            requestEndTurn();
            return { content: [{ type: 'text', text: 'Turn ended.' }] };
        },
        { annotations: { readOnlyHint: !enableChoicePrompts } }
    );

    return createSdkMcpServer({
        name: 'game_state',
        version: '1.0.0',
        tools: [...writeTools, ...readTools, endTurn],
        alwaysLoad: true,
    });
}

/**
 * Returns the qualified MCP tool name pattern for `allowedTools`. Once the
 * MCP server is registered under name "game_state", individual tools become
 * `mcp__game_state__<tool>`. We list each one explicitly so we don't
 * accidentally bypass deferred-loading semantics.
 */
export function allTools(enableSceneImages = false): string[] {
    const cmds = commandEntries(enableSceneImages).map(([, c]) => `mcp__game_state__${c.name}`);
    const queries = Object.values(QUERIES).map(q => `mcp__game_state__${q.name}`);
    return [...cmds, ...queries, 'mcp__game_state__end_turn'];
}

function commandEntries(enableSceneImages: boolean): [string, (typeof COMMANDS)[keyof typeof COMMANDS]][] {
    return Object.entries(COMMANDS).filter(([key]) =>
        key !== 'choice_prompt' && (key !== 'generate_image' || enableSceneImages));
}

function unwrapToShape(schema: z.ZodTypeAny): Record<string, z.ZodTypeAny> {
    if (schema instanceof z.ZodObject) {
        return (schema as z.ZodObject<any>).shape as Record<string, z.ZodTypeAny>;
    }
    return {} as Record<string, z.ZodTypeAny>;
}
