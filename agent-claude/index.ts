import { createSdkMcpServer, tool, query, startup, forkSession, getSessionInfo, getSessionMessages, getSubagentMessages, type SdkMcpToolDefinition, type AgentDefinition } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";

const agentConfig = {
  options: {
    allowedTools: ["Read", "Edit", "Glob", "WebSearch"],
    permissionMode: "acceptEdits"
  }
};

const oauthToken = Bun.env.CLAUDE_CODE_OAUTH_TOKEN;
const tools = [
    tool(
        "TestTool",
        "This is a test tool that echoes the input back to the user.",
        {
            input: z.object({
                message: z.string()
            })
        },
        async (args) => {
            return {
                content: [{ type: "text", text: `You said: ${args.input.message}` }]
            };
        }
    ),
    tool(
        "EndTurn",
        "End your turn and await the next prompt.",
        {},
        async () => {
            return {
                content: []
            };
        }
    )
];
async function main() {
    if (!oauthToken) {
        console.error("Error: CLAUDE_CODE_OAUTH_TOKEN environment variable is not set.");
        process.exit(1);
    };

    const agentAbortController = new AbortController();
    
    const warmQuery = await startup({
        initializeTimeoutMs: 5000,
        options: {
            sandbox: {
                enabled: true,
            },
            abortController: agentAbortController,
            tools: [
                ...Object.keys(tool)
            ],
            systemPrompt: await new Promise(async (resolve, reject) => {
                const file = Bun.file("./prompts/RP_PROMPT.md");

                if (!await file.exists()) {
                    console.error("Error: RP_PROMPT.md file not found.");
                    process.exit(1);
                }

                const text = await file.text();
                resolve(`<!-- THIS IS A TEST RUN. CALL TestTool ONCE, THEN CALL EndTurn. IGNORE THE REST OF THE SYSTEM INSTRUCTION. -->\n\n${text}`);
            }),
        }
    });

    const httpServer = Bun.serve({
        port: 8076,
        routes: {
            "/prompt": {
                POST: async (req, ctx) => {
                    const data = await req.json() as { prompt: string };
                    
                    // what does the Query object do? how to use it?
                    const query = warmQuery.query(data.prompt);
                    
                    return new Response("Prompt received and processed.");
                }
            }
        }
    });
}

await main();