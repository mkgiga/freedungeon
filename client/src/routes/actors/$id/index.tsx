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
      onSaved={() => navigate({ to: '/actors' })}
    />
  )
}
