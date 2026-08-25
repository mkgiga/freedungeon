import { tool, createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { SCENARIO_TOOLS } from '@shared/scenario-agent/tools';
import { rpcScenarioTool } from './rpc';

/**
 * MCP surface for the Scenario collaborator, built from the same registry the
 * AI-SDK path uses. The subprocess never implements a tool itself — every call
 * goes back to the server, which owns the scoped deps. That's what keeps the
 * two providers behaviourally identical.
 *
 * The scenario id is closed over per prompt, so a tool cannot act on a
 * different scenario than the one the panel is editing.
 */
export function buildScenarioMcpServer(chatId: string) {
    const tools = Object.entries(SCENARIO_TOOLS).map(([key, spec]) =>
        tool(
            spec.name,
            spec.description,
            unwrapToShape(spec.schema),
            async (args) => {
                const result = await rpcScenarioTool(chatId, key, args as Record<string, unknown>);
                if ('error' in result) {
                    return { content: [{ type: 'text', text: `Tool error: ${result.error}` }], isError: true };
                }
                return { content: [{ type: 'text', text: result.result }] };
            },
            spec.destructive ? { annotations: { destructiveHint: true } } : undefined,
        ),
    );

    return createSdkMcpServer({ name: 'scenario', version: '1.0.0', tools });
}

/** Tool names once registered under the `scenario` server. */
export function scenarioAllowedTools(): string[] {
    return Object.values(SCENARIO_TOOLS).map(spec => `mcp__scenario__${spec.name}`);
}

function unwrapToShape(schema: z.ZodTypeAny): Record<string, z.ZodTypeAny> {
    const def = (schema as unknown as { def?: { shape?: Record<string, z.ZodTypeAny> } }).def;
    if (def?.shape) return def.shape;
    const legacy = (schema as unknown as { _def?: { shape?: unknown } })._def?.shape;
    if (typeof legacy === 'function') return (legacy as () => Record<string, z.ZodTypeAny>)();
    if (legacy && typeof legacy === 'object') return legacy as Record<string, z.ZodTypeAny>;
    return {};
}
