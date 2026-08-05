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
      // Saving drops out of edit mode, and onto the id the server settled on —
      // customId is editable, so it may not be the one in the URL.
      onSaved={(customId) => {
        if (search().edit) {
          navigate({ to: '/actors/$id', params: { id: customId }, search: { edit: false }, replace: true })
        }
      }}
    />
  )
}
