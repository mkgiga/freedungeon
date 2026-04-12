import { createFileRoute, useNavigate } from '@tanstack/solid-router'
import { state } from '../../state'
import { trpc } from '../../trpc'
import { Em } from '../../components/typography/Em'
import { Text } from '../../components/typography/Text'
import { TopBar } from '../../components/TopBar'
import { MdFillAdd } from 'solid-icons/md'
import { NoteList } from '../../components/notes'
import { useModal } from '../../components/Modal'

export const Route = createFileRoute('/notes/')({
  component: RouteComponent,
})

function RouteComponent() {
  const navigate = useNavigate()
  const modal = useModal()

  return (
    <div class="flex flex-col h-full overflow-hidden">
      <TopBar title="Notes" slots={{
        right: (
          <button onClick={() => {
            navigate({ to: '/notes/$id', params: { id: 'new' }, search: { edit: true } })
          }}>
            <MdFillAdd size={32} />
          </button>
        )
      }} />
      <div class="flex-1 overflow-y-auto">
        <NoteList
          notes={Object.values(state.assets.notes ?? {})}
          onNoteClick={(note) => {
            navigate({ to: '/notes/$id', params: { id: String(note.id) }, search: { edit: false } })
          }}
          actions={[
            {
              label: 'Edit',
              callback: (note) => {
                navigate({ to: '/notes/$id', params: { id: String(note.id) }, search: { edit: true } })
              },
            },
            {
              label: 'Delete',
              danger: true,
              callback: (note) => {
                modal.open({
                  title: 'Delete Note',
                  content: () => (
                    <div>
                      <Text>Are you sure you want to delete <Em type="danger" bold>{note.title}</Em>?</Text>
                      <div class="modal-confirm-actions">
                        <button class="modal-btn modal-btn-cancel" onClick={() => modal.close()}>Cancel</button>
                        <button class="modal-btn modal-btn-confirm" onClick={() => { trpc.notes.delete.mutate({ id: note.id }); modal.close() }}>Confirm</button>
                      </div>
                    </div>
                  ),
                })
              },
            },
          ]}
        />
      </div>
    </div>
  )
}
