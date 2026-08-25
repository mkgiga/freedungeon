import { createMemo, Show } from 'solid-js'
import { state } from '../../state'
import { visible } from '@shared/visibility'
import { Heading } from '../typography/Heading'
import { Text } from '../typography/Text'
import { ActorCardGrid } from '../chat/ActorCardGrid'
import { NoteList } from '../notes'
import type { Actor, Note } from '@shared/types'

export function ScenarioAssetsPanel(props: { scenarioId: string }) {
    const scenario = () => state.assets.chats?.[props.scenarioId]

    const actors = createMemo<Actor[]>(() => visible(
        (scenario()?.assets.actors ?? [])
            .map(id => state.assets.actors?.[id])
            .filter((a): a is Actor => Boolean(a)),
    ))

    const notes = createMemo<Note[]>(() => visible(
        Object.keys(scenario()?.assets.notes ?? {})
            .map(id => state.assets.notes?.[id])
            .filter((n): n is Note => Boolean(n)),
    ))

    return (
        <div class="scenario-assets">
            <section>
                <Heading level={3}>Cast</Heading>
                <ActorCardGrid actors={actors()} emptyLabel="No characters yet." />
            </section>

            <section>
                <Heading level={3}>Notes</Heading>
                <Show
                    when={notes().length > 0}
                    fallback={<Text size="sm" class="opacity-50">No notes yet.</Text>}
                >
                    <NoteList notes={notes()} showType={false} hideHeader />
                </Show>
            </section>
        </div>
    )
}
