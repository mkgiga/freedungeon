import { runAgentPrompt, cancelCurrentTurn, forkAndReturnNewSessionId, type PromptArgs } from './src/bridge';

// CLAUDE_CODE_OAUTH_TOKEN is one of six ways the CLI can authenticate, and the
// least likely one here: a normal sign-in stores credentials on disk
// (~/.claude/.credentials.json, or the Keychain on macOS) and the CLI reads
// them itself. Treating the token as mandatory would make that stored-login
// path unreachable, so this is a note, not a gate — the server checks real
// readiness via `claude auth status` before letting an Anthropic config exist.
if (!Bun.env.CLAUDE_CODE_OAUTH_TOKEN) {
    console.log('Agent: no CLAUDE_CODE_OAUTH_TOKEN set; relying on the Claude CLI\'s stored credentials.');
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
                // runAgentPrompt now ALWAYS returns a structured result —
                // { ok: true, ... } on success/abort, { ok: false, error, ... }
                // on internal failure. We never throw out of it. Returning
                // 200 with a body that the server reads lets us distinguish
                // "expected agent failure" (Overloaded, transport closed)
                // from "agent process broken" (which would manifest as the
                // fetch itself failing on the server side).
                try {
                    const result = await runAgentPrompt(body);
                    return Response.json(result);
                } catch (err) {
                    // Defensive: if something inside runAgentPrompt's
                    // own catch+finally somehow throws, surface as a
                    // structured failure rather than HTTP 500 so the
                    // server can still parse the body.
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
