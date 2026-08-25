import { Show } from 'solid-js'
import { MdFillAdd } from 'solid-icons/md'
import { Text } from './typography/Text'

/**
 * The create affordance, as the first item in a list rather than an icon in a
 * corner - the first slot is where the eye lands, and it says what the screen
 * is for.
 *
 * `AddNewCard` for grids, `AddNewRow` for `.resource-table` lists.
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
 * Built from the same row and cell classes as a real item, so its height can't
 * drift from the rows around it. Only the bottom rule differs - dashed rather
 * than solid, to read as an empty slot.
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
