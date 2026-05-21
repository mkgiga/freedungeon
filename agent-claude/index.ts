import { runAgentPrompt, cancelCurrentTurn, forkAndReturnNewSessionId, type PromptArgs } from './src/bridge';

const oauthToken = Bun.env.CLAUDE_CODE_OAUTH_TOKEN;
if (!oauthToken) {
    console.error('Agent: CLAUDE_CODE_OAUTH_TOKEN is not set. Place it in agent-claude/.env or export it before starting the server.');
    process.exit(1);
}

const port = Number(process.env.AGENT_PORT ?? 8076);

Bun.serve({
    port,
    hostname: '127.0.0.1',
    routes: {
        '/health': () => new Response('ok'),

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
                    console.error('Agent /prompt error:', err);
                    return new Response(String(err), { status: 500 });
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
