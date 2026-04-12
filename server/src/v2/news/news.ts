import { router, procedure } from '../../trpc'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import type { NewsItem } from '@shared/types'

const NEWS_PATH = path.join(import.meta.dirname, '..', '..', '..', 'news.json')

export const newsRouter = router({
    list: procedure
        .query(async (): Promise<NewsItem[]> => {
            const raw = await readFile(NEWS_PATH, 'utf8')
            const parsed = JSON.parse(raw) as { news: NewsItem[] }
            return [...parsed.news].sort((a, b) =>
                b.timestamp.localeCompare(a.timestamp)
            )
        }),
})
