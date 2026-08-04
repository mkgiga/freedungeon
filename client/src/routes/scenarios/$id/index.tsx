import { createFileRoute, useNavigate } from '@tanstack/solid-router'
import { ChatPresetEditor } from '../../../components/chat/ChatPresetEditor'

export const Route = createFileRoute('/scenarios/$id/')({
    component: ScenarioDetailRoute,
    validateSearch: (search: Record<string, unknown>) => ({
        new: search.new === true || search.new === 'true',
    }),
})

/**
 * Same editor as /chat/$id — a Scenario is a chat with `isTemplate` set — but
 * reached from, and returning to, the Scenarios screen.
 */
function ScenarioDetailRoute() {
    const params = Route.useParams()
    const navigate = useNavigate()

    return (
        <ChatPresetEditor
            id={params().id}
            isTemplate
            onDone={() => navigate({ to: '/scenarios' })}
        />
    )
}
