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
}) {
    return (
        <tr class="resource-table-row" onClick={props.onClick}>
            <td class="resource-table-col-name">
                <span class="resource-table-cell-content">{props.note.title}</span>
            </td>
            <td>
                <span class="resource-table-cell-content opacity-50">{props.note.type || '—'}</span>
            </td>
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
}) {
    const { sortKey, sortDir, toggleSort, sort } = useSort<Note>('title')

    const sorted = createMemo(() => sort(props.notes))

    return (
        <table class="resource-table">
            <thead>
                <tr>
                    <SortHeader label="Title" active={sortKey() === 'title'} dir={sortDir()} onClick={() => toggleSort('title')} />
                    <SortHeader label="Type" active={sortKey() === 'type'} dir={sortDir()} onClick={() => toggleSort('type')} />
                    <Show when={props.actions}><th class="resource-table-col-actions"></th></Show>
                </tr>
            </thead>
            <tbody>
                <For each={sorted()} fallback={
                    <tr><td colSpan={3} class="resource-table-empty">No notes yet</td></tr>
                }>
                    {(note) => (
                        <NoteListItem
                            note={note}
                            actions={props.actions}
                            onClick={() => props.onNoteClick?.(note)}
                        />
                    )}
                </For>
            </tbody>
        </table>
    )
}
