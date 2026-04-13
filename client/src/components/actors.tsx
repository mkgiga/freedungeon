import type { Actor } from "@shared/types"
import { createMemo, For, Show, type JSXElement } from "solid-js"
import { MdFillMore_horiz } from "solid-icons/md"
import { Dropdown } from "./Dropdown"
import { SortHeader, useSort } from "./ResourceTable"
import { ImageIcon } from "./ImageIcon"
import { thumbnailUrl } from "../utils/media"

export type ActorAction = {
    label: string
    callback: (actor: Actor) => void
    danger?: boolean
    icon?: JSXElement
}

function ActorListItem(props: {
    actor: Actor
    actions?: ActorAction[]
    onClick?: () => void
    selected?: boolean
}) {
    const initials = () => props.actor.name?.charAt(0)?.toUpperCase() ?? '?'

    return (
        <tr class="resource-table-row" classList={{ selected: props.selected }} onClick={props.onClick}>
            <td class="resource-table-col-avatar">
                <ImageIcon
                    url={thumbnailUrl(props.actor.avatarUrl)}
                    size={40}
                    class="actor-avatar"
                    placeholder={<div class="actor-avatar-fallback">{initials()}</div>}
                />
            </td>
            <td class="resource-table-col-name"><span class="resource-table-cell-content">{props.actor.name}</span></td>
            <Show when={props.actions && props.actions.length > 0}>
                <td class="resource-table-col-actions" onClick={(e) => e.stopPropagation()}>
                    <Dropdown
                        trigger={<MdFillMore_horiz size={20} />}
                        items={props.actions!.map(a => ({
                            label: a.label,
                            icon: a.icon,
                            danger: a.danger,
                            onClick: () => a.callback(props.actor),
                        }))}
                    />
                </td>
            </Show>
        </tr>
    )
}

export function ActorList(props: {
    actors: Actor[]
    actions?: ActorAction[]
    onActorClick?: (actor: Actor) => void
    isSelected?: (actor: Actor) => boolean
    hideHeader?: boolean
}) {
    const { sortKey, sortDir, toggleSort, sort } = useSort<Actor>('name')

    const sorted = createMemo(() => sort(props.actors))

    return (
        <table class="resource-table">
            <Show when={!props.hideHeader}>
                <thead>
                    <tr>
                        <th class="resource-table-col-avatar"></th>
                        <SortHeader label="Name" active={sortKey() === 'name'} dir={sortDir()} onClick={() => toggleSort('name')} />
                        <Show when={props.actions}><th class="resource-table-col-actions"></th></Show>
                    </tr>
                </thead>
            </Show>
            <tbody>
                <For each={sorted()} fallback={
                    <tr><td colSpan={3} class="resource-table-empty">No characters yet</td></tr>
                }>
                    {(actor) => (
                        <ActorListItem
                            actor={actor}
                            actions={props.actions}
                            onClick={() => props.onActorClick?.(actor)}
                            selected={props.isSelected?.(actor)}
                        />
                    )}
                </For>
            </tbody>
        </table>
    )
}
