import { createFileRoute, useNavigate } from '@tanstack/solid-router'
import { MdFillCheck } from 'solid-icons/md'

import { TopBar } from '../../../components/TopBar'
import { ActorEditor } from '../../../components/ActorEditor'

export const Route = createFileRoute('/actors/$id/')({
  component: RouteComponent,
  validateSearch: (search: Record<string, unknown>) => ({
    edit: search.edit === true || search.edit === 'true',
  }),
})

/**
 * The actor editor as a screen. The editor itself is a component because the
 * Scenario editor opens the same UI in a modal — see components/ActorEditor.
 */
function RouteComponent() {
  const params = Route.useParams()
  const search = Route.useSearch()
  const navigate = useNavigate()

  return (
    <ActorEditor
      customId={params().id}
      edit={search().edit}
      chrome={(ctx) => (
        <TopBar
          backButton
          title={ctx.name}
          slots={{
            right: ctx.editing ? (
              <button onClick={ctx.save}>
                <MdFillCheck size={28} />
              </button>
            ) : undefined,
          }}
        />
      )}
      // Back to the list rather than into a read-only view of what you just
      // wrote: saving is the end of the task, and staying on the page reads as
      // "nothing happened" — the only visible change is fields greying out.
      onSaved={() => navigate({ to: '/actors' })}
    />
  )
}
