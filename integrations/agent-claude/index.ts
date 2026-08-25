import { runAgentPrompt, cancelCurrentTurn, forkAndReturnNewSessionId, runScenarioPrompt, type PromptArgs, type ScenarioPromptArgs } from './src/bridge';

if (!Bun.env.CLAUDE_CODE_OAUTH_TOKEN) {
    console.log('Agent: no CLAUDE_CODE_OAUTH_TOKEN set; relying on the Claude CLI\'s stored credentials.');
}

const port = Number(process.env.AGENT_PORT ?? 8076);

Bun.serve({
    port,
    hostname: '127.0.0.1',
    routes: {
        '/health': () => new Response('ok'),

        '/scenario-prompt': {
            POST: async (req: Request) => {
                let body: ScenarioPromptArgs;
                try {
                    body = await req.json() as ScenarioPromptArgs;
                } catch {
                    return new Response('invalid_json', { status: 400 });
                }
                return Response.json(await runScenarioPrompt(body));
            },
        },

        '/prompt': {
            POST: async (req) => {
                let body: PromptArgs;
                try {
                    body = await req.json() as PromptArgs;
                } catch {
                    return new Response('invalid_json', { status: 400 });
                }
                try {
                    const result = await runAgentPrompt(body);
                    return Response.json(result);
                } catch (err) {
                    console.error('Agent /prompt unexpected throw:', err);
                    return Response.json({
                        ok: false,
                        sessionId: null,
                        error: err instanceof Error ? err.message : String(err),
                        errorName: err instanceof Error ? err.name : undefined,
                    });
                }
            },
        },

        '/fork': {
            POST: async (req) => {
                let body: { sessionId: string; upToMessageId: string };
                try {
                    body = await req.json() as { sessionId: string; upToMessageId: string };
                } catch {
                    return new Response('invalid_json', { status: 400 });
                }
                try {
                    const result = await forkAndReturnNewSessionId(body);
                    return Response.json(result);
                } catch (err) {
                    console.error('Agent /fork error:', err);
                    return new Response(String(err), { status: 500 });
                }
            },
        },

        '/cancel': {
            POST: () => {
                cancelCurrentTurn();
                return new Response('ok');
            },
        },
    },
});

console.log(`Agent process listening on http://127.0.0.1:${port}`);
