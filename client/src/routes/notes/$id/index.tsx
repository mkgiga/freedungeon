import { createFileRoute, useNavigate } from '@tanstack/solid-router'
import { MdFillCheck } from 'solid-icons/md'

import { TopBar } from '../../../components/TopBar'
import { NoteEditor } from '../../../components/NoteEditor'

export const Route = createFileRoute('/notes/$id/')({
  component: RouteComponent,
})

function RouteComponent() {
  const params = Route.useParams()
  const navigate = useNavigate()

  return (
    <NoteEditor
      noteId={params().id}
      chrome={(ctx) => (
        <TopBar
          backButton
          title={ctx.title}
          slots={{
            right: (
              <button onClick={ctx.save}>
                <MdFillCheck size={28} />
              </button>
            ),
          }}
        />
      )}
      onSaved={() => navigate({ to: '/notes' })}
    />
  )
}
