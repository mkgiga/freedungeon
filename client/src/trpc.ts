import { createTRPCClient, httpBatchLink } from '@trpc/client'
import type { AppRouter } from '../../server/src/v2/router'

export const trpc = createTRPCClient<AppRouter>({
    links: [
        httpBatchLink({
            url: 'http://localhost:8078/trpc',
        }),
    ],
})
