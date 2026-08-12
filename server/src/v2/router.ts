import { router } from '../trpc'
import { actorsRouter } from './actors/actors'
import { chatRouter } from './chat/chat'
import { notesRouter } from './notes/notes'
import { imagesRouter } from './images/images'
import { llmConfigsRouter } from './llm-configs/llm-configs'
import { preferencesRouter } from './preferences/preferences'
import { newsRouter } from './news/news'
import { dependenciesRouter } from './dependencies/dependencies'
import { scenarioAgentRouter } from './scenario-agent/scenario-agent'
import { extensionsRouter } from './extensions/extensions'

export const appRouter = router({
    dependencies: dependenciesRouter,
    scenarioAgent: scenarioAgentRouter,
    extensions: extensionsRouter,
    actors: actorsRouter,
    chat: chatRouter,
    notes: notesRouter,
    images: imagesRouter,
    llmConfigs: llmConfigsRouter,
    preferences: preferencesRouter,
    news: newsRouter,
})

export type AppRouter = typeof appRouter
