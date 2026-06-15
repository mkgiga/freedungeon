import { tool, createSdkMcpServer, type SdkMcpToolDefinition } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { COMMANDS } from '@shared/game-state/commands';
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
export function buildGameStateMcpServer(enableChoicePrompts: boolean) {
    const writeTools = commandEntries(enableChoicePrompts).map(([key, spec]) => {
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

    const endTurn = tool(
        'end_turn',
        'Call this when the causal chain initiated by the user\'s prompt is fully resolved and you have nothing more to do. After end_turn, the conversation hands control back to the user.',
        {},
        async () => {
            requestEndTurn();
            return { content: [{ type: 'text', text: 'Turn ended.' }] };
        },
        { annotations: { readOnlyHint: true } }
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
export function allTools(enableChoicePrompts: boolean): string[] {
    const cmds = commandEntries(enableChoicePrompts).map(([, c]) => `mcp__game_state__${c.name}`);
    const queries = Object.values(QUERIES).map(q => `mcp__game_state__${q.name}`);
    return [...cmds, ...queries, 'mcp__game_state__end_turn'];
}

/**
 * The command registry, with feature-gated commands filtered out when their
 * global setting is off. Keeping this in one place keeps the MCP server's tool
 * set and the `allowedTools` allowlist in agreement.
 */
function commandEntries(enableChoicePrompts: boolean): [string, (typeof COMMANDS)[keyof typeof COMMANDS]][] {
    return Object.entries(COMMANDS).filter(([key]) =>
        key === 'choice_prompt' ? enableChoicePrompts : true
    );
}

/**
 * The `tool()` factory expects a ZodRawShape (`{ key: ZodType, ... }`) but
 * our specs hold ZodObject<shape>. Unwrap the inner shape.
 */
function unwrapToShape(schema: z.ZodTypeAny): Record<string, z.ZodTypeAny> {
    if (schema instanceof z.ZodObject) {
        return (schema as z.ZodObject<any>).shape as Record<string, z.ZodTypeAny>;
    }
    return {} as Record<string, z.ZodTypeAny>;
}
