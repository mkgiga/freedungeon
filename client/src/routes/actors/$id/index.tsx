import { createFileRoute, useNavigate } from '@tanstack/solid-router'
import { MdFillCheck } from 'solid-icons/md'

import { TopBar } from '../../../components/TopBar'
import { ActorEditor } from '../../../components/ActorEditor'

export const Route = createFileRoute('/actors/$id/')({
  component: RouteComponent,
})

function RouteComponent() {
  const params = Route.useParams()
  const navigate = useNavigate()

  return (
    <ActorEditor
      customId={params().id}
      chrome={(ctx) => (
        <TopBar
          backButton
          title={ctx.name}
          slots={{
            right: (
              <button onClick={ctx.save}>
                <MdFillCheck size={28} />
              </button>
            ),
          }}
        />
      )}
      onSaved={() => navigate({ to: '/actors' })}
    />
  )
}
