import type { Note } from "@shared/types"
import { createMemo, For, Show, type JSXElement } from "solid-js"
import { MdFillMore_horiz, MdFillVisibility, MdFillVisibility_off } from "solid-icons/md"
import { Dropdown } from "./Dropdown"
import { SortHeader, useSort } from "./ResourceTable"

export type NoteAction = {
    label: string
    callback: (note: Note) => void
    danger?: boolean
    icon?: JSXElement
    /** If provided, action is only rendered for notes where this returns true. */
    show?: (note: Note) => boolean
}

/**
 * Per-row inline on/off eye toggle. Toggled-off rows are dimmed with the
 * title struck through. Clicking anywhere on the row toggles too.
 */
export type NoteToggle = {
    checked: (note: Note) => boolean
    onToggle: (note: Note, next: boolean) => void
    /** Tooltip on the eye button, e.g. "Include in prompts". */
    title?: string
}

function NoteListItem(props: {
    note: Note
    actions?: NoteAction[]
    toggle?: NoteToggle
    onClick?: () => void
    selected?: boolean
    showType?: boolean
}) {
    return (
        <tr
            class="resource-table-row"
            classList={{ selected: props.selected, 'is-disabled': props.toggle ? !props.toggle.checked(props.note) : false }}
            onClick={() => {
                if (props.toggle) props.toggle.onToggle(props.note, !props.toggle.checked(props.note))
                else props.onClick?.()
            }}
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
            <Show when={props.toggle}>
                <td class="resource-table-col-actions" onClick={(e) => e.stopPropagation()}>
                    <button
                        class="dropdown-trigger note-toggle"
                        title={props.toggle!.title}
                        onClick={() => props.toggle!.onToggle(props.note, !props.toggle!.checked(props.note))}
                    >
                        <Show when={props.toggle!.checked(props.note)} fallback={<MdFillVisibility_off size={16} />}>
                            <MdFillVisibility size={16} />
                        </Show>
                    </button>
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
    toggle?: NoteToggle
    onNoteClick?: (note: Note) => void
    isSelected?: (note: Note) => boolean
    showType?: boolean
    hideHeader?: boolean
    /** Optional JSX rendered in a consistent toolbar row above the table
     *  (typically search inputs, filter pills, etc.). */
    toolbar?: JSXElement
}) {
    const { sortKey, sortDir, toggleSort, sort } = useSort<Note>('title')
    const showType = () => props.showType ?? true

    const sorted = createMemo(() => sort(props.notes))

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
                            <Show when={props.toggle}><th class="resource-table-col-actions"></th></Show>
                            <Show when={props.actions}><th class="resource-table-col-actions"></th></Show>
                        </tr>
                    </thead>
                </Show>
                <tbody>
                    <For each={sorted()} fallback={
                        <tr><td colSpan={5} class="resource-table-empty">No notes yet</td></tr>
                    }>
                        {(note) => (
                            <NoteListItem
                                note={note}
                                actions={props.actions}
                                toggle={props.toggle}
                                onClick={() => props.onNoteClick?.(note)}
                                selected={props.isSelected?.(note)}
                                showType={showType()}
                            />
                        )}
                    </For>
                </tbody>
            </table>
        </div>
    )
}
