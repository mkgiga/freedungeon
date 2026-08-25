import { createFileRoute, useNavigate } from '@tanstack/solid-router'
import { MdFillCheck } from 'solid-icons/md'

import { TopBar } from '../../../components/TopBar'
import { NoteEditor } from '../../../components/NoteEditor'

export const Route = createFileRoute('/notes/$id/')({
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
    <NoteEditor
      noteId={params().id}
      edit={search().edit}
      chrome={(ctx) => (
        <TopBar
          backButton
          title={ctx.title}
          slots={{
            right: ctx.editing ? (
              <button onClick={ctx.save}>
                <MdFillCheck size={28} />
              </button>
            ) : undefined,
          }}
        />
      )}
      onSaved={(id) => {
        if (search().edit) {
          navigate({ to: '/notes/$id', params: { id }, search: { edit: false }, replace: true })
        }
      }}
    />
  )
}
