import type { Note } from "@shared/types"
import { createMemo, For, Show, type JSXElement } from "solid-js"
import { MdFillMore_horiz } from "solid-icons/md"
import { Dropdown } from "./Dropdown"
import { SortHeader, useSort } from "./ResourceTable"
import { AddNewRow, type AddNew } from "./AddNew"

export type NoteAction = {
    label: string
    callback: (note: Note) => void
    danger?: boolean
    icon?: JSXElement
    show?: (note: Note) => boolean
}

function NoteListItem(props: {
    note: Note
    actions?: NoteAction[]
    disabled?: (note: Note) => boolean
    flashing?: boolean
    onClick?: () => void
    selected?: boolean
    showType?: boolean
}) {
    return (
        <tr
            class="resource-table-row"
            classList={{
                selected: props.selected,
                'is-disabled': props.disabled?.(props.note) ?? false,
                'is-flashing': props.flashing,
            }}
            onClick={() => props.onClick?.()}
        >
            <td class="resource-table-col-emoji">
                <Show when={props.note.emoji} fallback={<span class="opacity-30">📝</span>}>
                    <span>{props.note.emoji}</span>
                </Show>
            </td>
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
                        items={props.actions!
                            .filter(a => !a.show || a.show(props.note))
                            .map(a => ({
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
    disabled?: (note: Note) => boolean
    addNew?: AddNew
    isFlashing?: (note: Note) => boolean
    priority?: (note: Note) => number
    onNoteClick?: (note: Note) => void
    isSelected?: (note: Note) => boolean
    showType?: boolean
    hideHeader?: boolean
    toolbar?: JSXElement
}) {
    const { sortKey, sortDir, toggleSort, sort } = useSort<Note>('title')
    const showType = () => props.showType ?? true

    const sorted = createMemo(() => {
        const rows = sort(props.notes)
        const priority = props.priority
        if (!priority) return rows
        return [...rows].sort((a, b) => priority(b) - priority(a))
    })

    const columns = () => 2 + (showType() ? 1 : 0) + (props.actions ? 1 : 0)

    return (
        <div class="resource-list">
            <Show when={props.toolbar}>
                <div class="resource-table-toolbar">{props.toolbar}</div>
            </Show>
            <table class="resource-table">
                <Show when={!props.hideHeader}>
                    <thead>
                        <tr>
                            <th class="resource-table-col-emoji"></th>
                            <SortHeader label="Title" active={sortKey() === 'title'} dir={sortDir()} onClick={() => toggleSort('title')} />
                            <Show when={showType()}>
                                <SortHeader label="Type" active={sortKey() === 'type'} dir={sortDir()} onClick={() => toggleSort('type')} />
                            </Show>
                            <Show when={props.actions}><th class="resource-table-col-actions"></th></Show>
                        </tr>
                    </thead>
                </Show>
                <tbody>
                    <Show when={props.addNew && (props.addNew.position ?? 'start') === 'start'}>
                        <AddNewRow
                            label={props.addNew!.label}
                            onClick={props.addNew!.onClick}
                            leadingClass="resource-table-col-emoji"
                            columns={columns()}
                        />
                    </Show>
                    <For each={sorted()} fallback={
                        <Show when={!props.addNew}>
                            <tr><td colSpan={5} class="resource-table-empty">No notes yet</td></tr>
                        </Show>
                    }>
                        {(note) => (
                            <NoteListItem
                                note={note}
                                actions={props.actions}
                                disabled={props.disabled}
                                flashing={props.isFlashing?.(note)}
                                onClick={props.onNoteClick ? () => props.onNoteClick!(note) : undefined}
                                selected={props.isSelected?.(note)}
                                showType={showType()}
                            />
                        )}
                    </For>
                    <Show when={props.addNew && props.addNew.position === 'end'}>
                        <AddNewRow
                            label={props.addNew!.label}
                            onClick={props.addNew!.onClick}
                            leadingClass="resource-table-col-emoji"
                            columns={columns()}
                        />
                    </Show>
                </tbody>
            </table>
        </div>
    )
}
