import type { Chat } from "@shared/types"
import { createMemo, For, Show, type JSXElement } from "solid-js"
import { MdFillMore_horiz } from "solid-icons/md"
import { Dropdown } from "./Dropdown"
import { SortHeader, useSort } from "./ResourceTable"

export type ChatAction = {
    label: string
    callback: (chat: Chat) => void
    danger?: boolean
    icon?: JSXElement
}

function formatTimestamp(ms: number): string {
    const d = new Date(ms)
    const now = Date.now()
    const diff = now - ms

    if (diff < 60_000) return 'just now'
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
    if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
    if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)}d ago`
    return d.toLocaleDateString()
}

function ChatListItem(props: {
    chat: Chat
    actions?: ChatAction[]
    onClick?: () => void
}) {
    return (
        <tr class="resource-table-row" onClick={props.onClick}>
            <td class="resource-table-col-name">
                <span class="resource-table-cell-content">{props.chat.title}</span>
            </td>
            <td>
                <span class="resource-table-cell-content opacity-50">{formatTimestamp(props.chat.updatedAt)}</span>
            </td>
            <Show when={props.actions && props.actions.length > 0}>
                <td class="resource-table-col-actions" onClick={(e) => e.stopPropagation()}>
                    <Dropdown
                        trigger={<MdFillMore_horiz size={20} />}
                        items={props.actions!.map(a => ({
                            label: a.label,
                            icon: a.icon,
                            danger: a.danger,
                            onClick: () => a.callback(props.chat),
                        }))}
                    />
                </td>
            </Show>
        </tr>
    )
}

export function ChatList(props: {
    chats: Chat[]
    actions?: ChatAction[]
    onChatClick?: (chat: Chat) => void
}) {
    const { sortKey, sortDir, toggleSort, sort } = useSort<Chat>('updatedAt', 'desc')

    const sorted = createMemo(() => sort(props.chats))

    return (
        <table class="resource-table">
            <thead>
                <tr>
                    <SortHeader label="Title" active={sortKey() === 'title'} dir={sortDir()} onClick={() => toggleSort('title')} />
                    <SortHeader label="Updated" active={sortKey() === 'updatedAt'} dir={sortDir()} onClick={() => toggleSort('updatedAt')} />
                    <Show when={props.actions}><th class="resource-table-col-actions"></th></Show>
                </tr>
            </thead>
            <tbody>
                <For each={sorted()} fallback={
                    <tr><td colSpan={3} class="resource-table-empty">No chats yet</td></tr>
                }>
                    {(chat) => (
                        <ChatListItem
                            chat={chat}
                            actions={props.actions}
                            onClick={() => props.onChatClick?.(chat)}
                        />
                    )}
                </For>
            </tbody>
        </table>
    )
}
