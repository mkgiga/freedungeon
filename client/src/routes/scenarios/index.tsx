import { createFileRoute, useNavigate } from '@tanstack/solid-router'
import { createMemo, For, Show } from 'solid-js'
import { nanoid } from 'nanoid'
import { MdFillAdd, MdFillMore_horiz, MdFillPlay_arrow } from 'solid-icons/md'
import { state } from '../../state'
import { trpc } from '../../trpc'
import { TopBar } from '../../components/TopBar'
import { Text } from '../../components/typography/Text'
import { Em } from '../../components/typography/Em'
import { Heading } from '../../components/typography/Heading'
import { ImageIcon } from '../../components/ImageIcon'
import { Dropdown } from '../../components/Dropdown'
import { useModal } from '../../components/Modal'
import { setActiveTab } from '../../tab-state'
import type { Chat } from '@shared/types'
import { visible } from '@shared/visibility'

export const Route = createFileRoute('/scenarios/')({ component: RouteComponent })

/**
 * Scenarios — reusable adventure presets. Under the hood each one is a chat
 * with `isTemplate` set, which is why the editor is shared with /chat/$id; the
 * difference is entirely presentational. Playing one clones it into a fresh
 * chat so the preset itself is never consumed.
 */
function RouteComponent() {
    const navigate = useNavigate()
    const modal = useModal()

    const scenarios = createMemo<Chat[]>(() =>
        Object.values(state.assets.chats ?? {})
            .filter(c => c.isTemplate)
            .sort((a, b) => b.updatedAt - a.updatedAt),
    )

    const play = async (scenario: Chat) => {
        await trpc.chat.useTemplate.mutate({ templateId: scenario.id })
        // useTemplate loads the clone as the current chat; jump to it.
        setActiveTab('chat')
    }

    const create = () => {
        // Optimistic id, same as the chat flow: nothing hits the server until Save.
        navigate({ to: '/scenarios/$id', params: { id: nanoid() }, search: { new: true } })
    }

    const edit = (scenario: Chat) =>
        navigate({ to: '/scenarios/$id', params: { id: scenario.id }, search: { new: false } })

    const duplicate = (scenario: Chat) =>
        trpc.chat.saveAsTemplate.mutate({ sourceChatId: scenario.id, newTitle: `${scenario.title} (copy)` })

    const remove = (scenario: Chat) => {
        modal.open({
            title: 'Delete Scenario',
            content: () => (
                <div>
                    <Text>Delete <Em type="danger" bold>{scenario.title}</Em>? Chats already started from it are unaffected.</Text>
                    <div class="modal-confirm-actions">
                        <button class="modal-btn modal-btn-cancel" onClick={() => modal.close()}>Cancel</button>
                        <button
                            class="modal-btn modal-btn-confirm"
                            onClick={() => { trpc.chat.delete.mutate({ id: scenario.id }); modal.close() }}
                        >Confirm</button>
                    </div>
                </div>
            ),
        })
    }

    const castOf = (scenario: Chat) =>
        visible(scenario.assets.actors
            .map(id => state.assets.actors?.[id])
            .filter((a): a is NonNullable<typeof a> => Boolean(a)))
            .slice(0, 5)

    return (
        <div class="flex flex-col h-full overflow-hidden">
            <TopBar
                title="Scenarios"
                slots={{
                    right: (
                        <button onClick={create} title="New scenario">
                            <MdFillAdd size={32} />
                        </button>
                    ),
                }}
            />
            <div class="flex-1 overflow-y-auto p-4">
                <Show
                    when={scenarios().length > 0}
                    fallback={
                        <div class="scenario-empty">
                            <Heading level={3}>No scenarios yet</Heading>
                            <Text size="sm" class="opacity-60">
                                A scenario is a ready-to-play setup — a cast, some notes, a premise.
                                Start one with +, or save an existing chat as a scenario.
                            </Text>
                        </div>
                    }
                >
                    <div class="scenario-grid">
                        <For each={scenarios()}>
                            {(scenario) => (
                                <article class="scenario-card">
                                    <button class="scenario-card-hero" onClick={() => play(scenario)} title={`Play ${scenario.title}`}>
                                        <Show when={scenario.bannerUrl} fallback={<div class="scenario-card-banner is-empty" />}>
                                            <img class="scenario-card-banner" src={scenario.bannerUrl} alt="" />
                                        </Show>
                                        <span class="scenario-card-play"><MdFillPlay_arrow size={28} /></span>
                                    </button>

                                    <div class="scenario-card-body">
                                        <div class="scenario-card-heading">
                                            <ImageIcon url={scenario.avatarUrl || undefined} size={36} />
                                            <div class="scenario-card-titles">
                                                <Text class="scenario-card-title">{scenario.title}</Text>
                                                <Text size="sm" class="scenario-card-meta">
                                                    {scenario.assets.actors.length} {scenario.assets.actors.length === 1 ? 'character' : 'characters'}
                                                </Text>
                                            </div>
                                            <Dropdown
                                                trigger={<MdFillMore_horiz size={20} />}
                                                items={[
                                                    { label: 'Play', onClick: () => play(scenario) },
                                                    { label: 'Edit', onClick: () => edit(scenario) },
                                                    { label: 'Duplicate', onClick: () => duplicate(scenario) },
                                                    { label: 'Delete', danger: true, onClick: () => remove(scenario) },
                                                ]}
                                            />
                                        </div>

                                        <Show when={scenario.description}>
                                            <Text size="sm" class="scenario-card-description">{scenario.description}</Text>
                                        </Show>

                                        <Show when={castOf(scenario).length > 0}>
                                            <div class="scenario-card-cast">
                                                <For each={castOf(scenario)}>
                                                    {(actor) => <ImageIcon url={actor!.avatarUrl} size={26} class="scenario-card-cast-face" />}
                                                </For>
                                            </div>
                                        </Show>
                                    </div>
                                </article>
                            )}
                        </For>
                    </div>
                </Show>
            </div>
        </div>
    )
}
