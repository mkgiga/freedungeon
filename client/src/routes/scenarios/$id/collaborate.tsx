import { createFileRoute, useNavigate } from '@tanstack/solid-router'
import { MdFillSettings, MdFillView_sidebar } from 'solid-icons/md'
import { TopBar } from '../../../components/TopBar'
import { ScenarioCollaborator } from '../../../components/scenario/ScenarioCollaborator'
import { ScenarioAssetsPanel } from '../../../components/scenario/ScenarioAssetsPanel'
import { useScenarioAgentSettings } from '../../../components/scenario/ScenarioAgentSettings'
import { useDrawer } from '../../../components/Drawer'

export const Route = createFileRoute('/scenarios/$id/collaborate')({
    component: CollaborateRoute,
})

/**
 * The collaborator as a full screen, for phones — there's no room to dock it
 * beside the editor.
 *
 * Two things follow from that. Back goes to *this scenario's editor*, not the
 * recent-chats list: the collaborator lives in the Scenarios nav stack, and
 * landing in a different stack after a back press is disorienting. And the
 * scenario's cast and notes move into the right drawer, which is exactly where
 * a normal chat keeps the same information — so the gesture is already learned.
 */
function CollaborateRoute() {
    const params = Route.useParams()
    const navigate = useNavigate()
    const drawer = useDrawer()
    const openSettings = useScenarioAgentSettings()

    const scenarioId = () => params().id

    const openAssets = () => drawer.open({
        content: () => <ScenarioAssetsPanel scenarioId={scenarioId()} />,
    })

    return (
        <div class="flex flex-col h-full overflow-hidden">
            <TopBar
                title="Collaborator"
                backButton={() => navigate({
                    to: '/scenarios/$id',
                    params: { id: scenarioId() },
                    search: { new: false },
                })}
                slots={{
                    right: (
                        <>
                            <button onClick={openSettings} title="Collaborator settings">
                                <MdFillSettings size={24} />
                            </button>
                            <button onClick={openAssets} title="Cast & notes">
                                <MdFillView_sidebar size={26} />
                            </button>
                        </>
                    ),
                }}
            />
            <ScenarioCollaborator scenarioId={scenarioId()} />
        </div>
    )
}
