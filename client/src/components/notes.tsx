import type { Note } from "@shared/types"
import { createMemo, For, Show, type JSXElement } from "solid-js"
import { MdFillMore_horiz } from "solid-icons/md"
import { Dropdown } from "./Dropdown"
import { SortHeader, useSort } from "./ResourceTable"

export type NoteAction = {
    label: string
    callback: (note: Note) => void
    danger?: boolean
    icon?: JSXElement
}

function NoteListItem(props: {
    note: Note
    actions?: NoteAction[]
    onClick?: () => void
    selected?: boolean
    showType?: boolean
}) {
    return (
        <tr class="resource-table-row" classList={{ selected: props.selected }} onClick={props.onClick}>
            <td class="resource-table-col-name">
                <span class="resource-table-cell-content">{props.note.title}</span>
            </td>
            <Show when={props.showType}>
                <td>
                    <span class="resource-table-cell-content opacity-50">{props.note.type || '—'}</span>
                </td>
            </Show>
            <Show when={props.actions && props.actions.length > 0}>
                <td class="resource-table-col-actions" onClick={(e) => e.stopPropagation()}>
                    <Dropdown
                        trigger={<MdFillMore_horiz size={20} />}
                        items={props.actions!.map(a => ({
                            label: a.label,
                            icon: a.icon,
                            danger: a.danger,
                            onClick: () => a.callback(props.note),
                        }))}
                    />
                </td>
            </Show>
        </tr>
    )
}

export function NoteList(props: {
    notes: Note[]
    actions?: NoteAction[]
    onNoteClick?: (note: Note) => void
    isSelected?: (note: Note) => boolean
    showType?: boolean
    hideHeader?: boolean
}) {
    const { sortKey, sortDir, toggleSort, sort } = useSort<Note>('title')
    const showType = () => props.showType ?? true

    const sorted = createMemo(() => sort(props.notes))

    return (
        <table class="resource-table">
            <Show when={!props.hideHeader}>
                <thead>
                    <tr>
                        <SortHeader label="Title" active={sortKey() === 'title'} dir={sortDir()} onClick={() => toggleSort('title')} />
                        <Show when={showType()}>
                            <SortHeader label="Type" active={sortKey() === 'type'} dir={sortDir()} onClick={() => toggleSort('type')} />
                        </Show>
                        <Show when={props.actions}><th class="resource-table-col-actions"></th></Show>
                    </tr>
                </thead>
            </Show>
            <tbody>
                <For each={sorted()} fallback={
                    <tr><td colSpan={3} class="resource-table-empty">No notes yet</td></tr>
                }>
                    {(note) => (
                        <NoteListItem
                            note={note}
                            actions={props.actions}
                            onClick={() => props.onNoteClick?.(note)}
                            selected={props.isSelected?.(note)}
                            showType={showType()}
                        />
                    )}
                </For>
            </tbody>
        </table>
    )
}
