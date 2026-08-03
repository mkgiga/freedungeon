import { router, procedure } from '../../trpc'
import type { NewsItem } from '@shared/types'
// Bundled rather than read at request time: a compiled binary has no source
// tree to read it from. Same treatment config.json already gets in server.ts.
import newsData from '../../../news.json' with { type: 'json' }

export const newsRouter = router({
    list: procedure
        .query(async (): Promise<NewsItem[]> => {
            const parsed = newsData as { news: NewsItem[] }
            return [...parsed.news].sort((a, b) =>
                b.timestamp.localeCompare(a.timestamp)
            )
        }),
})
