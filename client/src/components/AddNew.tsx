import { Show } from 'solid-js'
import { MdFillAdd } from 'solid-icons/md'
import { Text } from './typography/Text'

/**
 * The create affordance, as the first item in a list rather than an icon in a
 * corner.
 *
 * A `+` in the top-right of a full-width screen sits in peripheral vision on a
 * desktop monitor — findable only if you already know it's there. The first
 * slot of the list is the one place the eye is guaranteed to land, and it also
 * answers "what is this screen for?" for someone who has never seen it.
 *
 * Two shapes: `AddNewCard` for grids, `AddNewRow` for `.resource-table` lists.
 */

/** Where the affordance sits relative to the existing items. */
export type AddNewPosition = 'start' | 'end'

export type AddNew = {
    label: string
    onClick: () => void
    position?: AddNewPosition
}

export function AddNewCard(props: { label: string; onClick: () => void }) {
    return (
        <button type="button" class="add-new add-new-card" onClick={props.onClick}>
            <MdFillAdd size={30} />
            <Text>{props.label}</Text>
        </button>
    )
}

/**
 * Built from the same row and cell classes as a real item, rather than a box
 * spanning the table.
 *
 * That's what keeps its height identical to the rows around it: padding,
 * line-height and cell metrics come from `.resource-table-cell-content`
 * itself, so it can't drift when those change. Only the bottom rule differs —
 * dashed instead of solid — to read as an empty slot.
 */
export function AddNewRow(props: {
    label: string
    onClick: () => void
    leadingClass?: string
    columns: number
}) {
    const used = () => (props.leadingClass ? 2 : 1)

    return (
        <tr class="resource-table-row add-new-tr" onClick={props.onClick}>
            <Show when={props.leadingClass}>
                {(cls) => (
                    <td class={cls()}>
                        <span class="add-new-icon"><MdFillAdd size={22} /></span>
                    </td>
                )}
            </Show>
            <td class="resource-table-col-name">
                <span class="resource-table-cell-content add-new-label">
                    <Show when={!props.leadingClass}><MdFillAdd size={22} /></Show>
                    {props.label}
                </span>
            </td>
            <Show when={props.columns > used()}>
                <td colSpan={props.columns - used()} />
            </Show>
        </tr>
    )
}
