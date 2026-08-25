import { router, procedure } from '../../trpc'
import type { NewsItem } from '@shared/types'
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
