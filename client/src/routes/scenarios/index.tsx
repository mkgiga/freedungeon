import { createFileRoute, useNavigate } from '@tanstack/solid-router'
import { createMemo, For, Show } from 'solid-js'
import { nanoid } from 'nanoid'
import { MdFillAdd, MdFillEdit, MdFillMore_horiz, MdFillPlay_arrow } from 'solid-icons/md'
import { state } from '../../state'
import { trpc } from '../../trpc'
import { TopBar } from '../../components/TopBar'
import { Text } from '../../components/typography/Text'
import { Em } from '../../components/typography/Em'
import { Heading } from '../../components/typography/Heading'
import { ImageIcon } from '../../components/ImageIcon'
import { Dropdown } from '../../components/Dropdown'
import { useModal } from '../../components/Modal'
import { setActiveTab, setChatView } from '../../tab-state'
import { AddNewCard } from '../../components/AddNew'
import type { Chat } from '@shared/types'

export const Route = createFileRoute('/scenarios/')({ component: RouteComponent })

function RouteComponent() {
    const navigate = useNavigate()
    const modal = useModal()

    const scenarios = createMemo<Chat[]>(() =>
        Object.values(state.assets.chats ?? {})
            .filter(c => c.isTemplate && (c.kind ?? 'roleplay') === 'roleplay')
            .sort((a, b) => b.updatedAt - a.updatedAt),
    )

    const play = async (scenario: Chat) => {
        await trpc.chat.useTemplate.mutate({ templateId: scenario.id })
        setChatView('conversation')
        setActiveTab('chat')
    }

    const create = () => {
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
                <Show when={scenarios().length === 0}>
                    <div class="scenario-empty">
                        <Heading level={3}>No scenarios yet</Heading>
                        <Text size="sm" class="opacity-60">
                            A cast, some notes, a premise. Start one below, or save a chat as one.
                        </Text>
                    </div>
                </Show>
                <div>
                    <div class="scenario-grid">
                        <AddNewCard label="New scenario" onClick={create} />
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
                                            <Text class="scenario-card-title">{scenario.title}</Text>
                                        </div>

                                        <Show when={scenario.description}>
                                            <Text size="sm" class="scenario-card-description">{scenario.description}</Text>
                                        </Show>

                                        <div class="scenario-card-actions">
                                            <button
                                                type="button"
                                                class="scenario-card-action"
                                                onClick={() => play(scenario)}
                                                title={`Play ${scenario.title}`}
                                            >
                                                <MdFillPlay_arrow size={18} />
                                                <Text size="sm">Play</Text>
                                            </button>
                                            <button
                                                type="button"
                                                class="scenario-card-action"
                                                onClick={() => edit(scenario)}
                                                title={`Edit ${scenario.title}`}
                                            >
                                                <MdFillEdit size={16} />
                                                <Text size="sm">Edit</Text>
                                            </button>
                                            <Dropdown
                                                trigger={<MdFillMore_horiz size={20} />}
                                                items={[
                                                    { label: 'Duplicate', onClick: () => duplicate(scenario) },
                                                    { label: 'Delete', danger: true, onClick: () => remove(scenario) },
                                                ]}
                                            />
                                        </div>
                                    </div>
                                </article>
                            )}
                        </For>
                    </div>
                </div>
            </div>
        </div>
    )
}
