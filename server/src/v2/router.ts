import { router } from '../trpc'
import { actorsRouter } from './actors/actors'
import { chatRouter } from './chat/chat'
import { notesRouter } from './notes/notes'
import { llmConfigsRouter } from './llm-configs/llm-configs'
import { preferencesRouter } from './preferences/preferences'
import { newsRouter } from './news/news'

export const appRouter = router({
    actors: actorsRouter,
    chat: chatRouter,
    notes: notesRouter,
    llmConfigs: llmConfigsRouter,
    preferences: preferencesRouter,
    news: newsRouter,
})

export type AppRouter = typeof appRouter
