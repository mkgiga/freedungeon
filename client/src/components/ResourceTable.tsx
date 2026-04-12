import { createSignal, Show } from 'solid-js'
import { MdFillArrow_drop_up, MdFillArrow_drop_down } from 'solid-icons/md'

export type SortDir = 'asc' | 'desc'

export function SortHeader(props: {
    label: string
    active: boolean
    dir: SortDir
    onClick: () => void
}) {
    return (
        <th class="resource-table-col-sortable" onClick={props.onClick}>
            <span>{props.label}</span>
            <Show when={props.active}>
                {props.dir === 'asc'
                    ? <MdFillArrow_drop_up size={16} />
                    : <MdFillArrow_drop_down size={16} />
                }
            </Show>
        </th>
    )
}

export function useSort<T>(defaultKey: keyof T, defaultDir: SortDir = 'asc') {
    const [sortKey, setSortKey] = createSignal<keyof T>(defaultKey)
    const [sortDir, setSortDir] = createSignal<SortDir>(defaultDir)

    const toggleSort = (key: keyof T) => {
        if (sortKey() === key) {
            setSortDir(d => d === 'asc' ? 'desc' : 'asc')
        } else {
            setSortKey(key as any)
            setSortDir('asc')
        }
    }

    const sort = (items: T[]): T[] => {
        const key = sortKey()
        const dir = sortDir()
        const mult = dir === 'asc' ? 1 : -1
        return [...items].sort((a, b) => {
            const aVal = a[key]
            const bVal = b[key]
            if (typeof aVal === 'string' && typeof bVal === 'string') {
                return aVal.localeCompare(bVal, undefined, { sensitivity: 'base' }) * mult
            }
            if ((aVal ?? '') < (bVal ?? '')) return -1 * mult
            if ((aVal ?? '') > (bVal ?? '')) return 1 * mult
            return 0
        })
    }

    return { sortKey, sortDir, toggleSort, sort }
}
