import type { LLMConfig } from "@shared/types"
import { createMemo, For, Show, type JSXElement } from "solid-js"
import { MdFillMore_horiz } from "solid-icons/md"
import { Dropdown } from "./Dropdown"
import { SortHeader, useSort } from "./ResourceTable"
import { Text } from "./typography/Text"

export type LLMConfigAction = {
    label: string
    callback: (config: LLMConfig) => void
    danger?: boolean
    icon?: JSXElement
}

function LLMConfigListItem(props: {
    config: LLMConfig
    actions?: LLMConfigAction[]
    onClick?: () => void
}) {
    return (
        <tr class="resource-table-row" onClick={props.onClick}>
            <td class="resource-table-col-name">
                <span class="resource-table-cell-content">{props.config.name}</span>
            </td>
            <td>
                <Text font="mono" class="resource-table-cell-content opacity-70">{props.config.model || '—'}</Text>
            </td>
            <Show when={props.actions && props.actions.length > 0}>
                <td class="resource-table-col-actions" onClick={(e) => e.stopPropagation()}>
                    <Dropdown
                        trigger={<MdFillMore_horiz size={20} />}
                        items={props.actions!.map(a => ({
                            label: a.label,
                            icon: a.icon,
                            danger: a.danger,
                            onClick: () => a.callback(props.config),
                        }))}
                    />
                </td>
            </Show>
        </tr>
    )
}

export function LLMConfigList(props: {
    configs: LLMConfig[]
    actions?: LLMConfigAction[]
    onConfigClick?: (config: LLMConfig) => void
}) {
    const { sortKey, sortDir, toggleSort, sort } = useSort<LLMConfig>('name')

    const sorted = createMemo(() => sort(props.configs))

    return (
        <table class="resource-table">
            <thead>
                <tr>
                    <SortHeader label="Name" active={sortKey() === 'name'} dir={sortDir()} onClick={() => toggleSort('name')} />
                    <SortHeader label="Model" active={sortKey() === 'model'} dir={sortDir()} onClick={() => toggleSort('model')} />
                    <Show when={props.actions}><th class="resource-table-col-actions"></th></Show>
                </tr>
            </thead>
            <tbody>
                <For each={sorted()} fallback={
                    <tr><td colSpan={3} class="resource-table-empty">No configs yet</td></tr>
                }>
                    {(config) => (
                        <LLMConfigListItem
                            config={config}
                            actions={props.actions}
                            onClick={() => props.onConfigClick?.(config)}
                        />
                    )}
                </For>
            </tbody>
        </table>
    )
}
