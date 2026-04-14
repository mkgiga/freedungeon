import { createTRPCClient, httpBatchLink } from '@trpc/client'
import type { AppRouter } from '../../server/src/v2/router'

// Dev (vite on :5173) proxies /trpc → :8078. Prod (client served by Hono on
// :8078) hits /trpc directly on the same origin. Relative URL works for both.
export const trpc = createTRPCClient<AppRouter>({
    links: [
        httpBatchLink({
            url: '/trpc',
        }),
    ],
})
