import { createFileRoute, useNavigate } from '@tanstack/solid-router'
import { state } from '../../state'
import { trpc } from '../../trpc'
import { Em } from '../../components/typography/Em'
import { Text } from '../../components/typography/Text'
import { TopBar } from '../../components/TopBar'
import { MdFillAdd } from 'solid-icons/md'
import { ActorList } from '../../components/actors'
import { nanoid } from 'nanoid'
import { useModal } from '../../components/Modal'

export const Route = createFileRoute('/actors/')({
  component: RouteComponent,
})

function RouteComponent() {
  const navigate = useNavigate()
  const modal = useModal()

  return (
    <div class="flex flex-col h-full overflow-hidden">
      <TopBar title="Characters" slots={{
        right: (
          <button onClick={() => {
            const newId = nanoid()
            navigate({ to: '/actors/$id', params: { id: newId }, search: { edit: true } })
          }}>
            <MdFillAdd size={32} />
          </button>
        )
      }} />
      <div class="flex-1 overflow-y-auto">
        <ActorList
          actors={Object.values(state.assets.actors ?? {})}
          onActorClick={(actor) => {
            navigate({ to: '/actors/$id', params: { id: actor.customId }, search: { edit: true } })
          }}
          actions={[
            {
              label: 'Edit',
              callback: (actor) => {
                navigate({ to: '/actors/$id', params: { id: actor.customId }, search: { edit: true } })
              },
            },
            {
              label: 'Delete',
              danger: true,
              callback: (actor) => {
                modal.open({
                  title: 'Delete Character',
                  content: () => (
                    <div>
                      <Text>Are you sure you want to delete <Em type="danger" bold>{actor.name}</Em>?</Text>
                      <div class="modal-confirm-actions">
                        <button class="modal-btn modal-btn-cancel" onClick={() => modal.close()}>Cancel</button>
                        <button class="modal-btn modal-btn-confirm" onClick={() => { trpc.actors.delete.mutate({ id: actor.id }); modal.close() }}>Confirm</button>
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
