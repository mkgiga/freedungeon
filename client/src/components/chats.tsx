import type { Chat } from "@shared/types"
import { createMemo, For, Show, type JSXElement } from "solid-js"
import { MdFillChat, MdFillMore_horiz } from "solid-icons/md"
import { Dropdown } from "./Dropdown"
import { ImageIcon } from "./ImageIcon"
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
    // The banner renders as a row-level ::before pseudo-element pulling its
    // URL from this custom property. Keeping it as a var instead of inline
    // background-image lets the CSS own the sizing/mask logic and also lets
    // the gradient span all cells rather than being clipped to one <td>.
    const rowStyle = () => props.chat.bannerUrl
        ? { '--chat-row-banner': `url(${JSON.stringify(props.chat.bannerUrl)})` }
        : undefined

    return (
        <tr class="resource-table-row chat-list-row" style={rowStyle()} onClick={props.onClick}>
            <td class="resource-table-col-avatar">
                <ImageIcon
                    url={props.chat.avatarUrl}
                    size={40}
                    class="actor-avatar"
                    placeholder={
                        <div class="actor-avatar-fallback">
                            <MdFillChat size={20} />
                        </div>
                    }
                />
            </td>
            <td class="resource-table-col-name">
                <span class="resource-table-cell-content">{props.chat.title}</span>
            </td>
            <td class="resource-table-col-timestamp">
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
    /** Optional JSX rendered in a consistent toolbar row above the table
     *  (typically search inputs, filter pills, etc.). */
    toolbar?: JSXElement
}) {
    const { sortKey, sortDir, toggleSort, sort } = useSort<Chat>('updatedAt', 'desc')

    const sorted = createMemo(() => sort(props.chats))

    return (
        <div class="resource-list">
            <Show when={props.toolbar}>
                <div class="resource-table-toolbar">{props.toolbar}</div>
            </Show>
            <table class="resource-table">
                <thead>
                    <tr>
                        <th class="resource-table-col-avatar"></th>
                        <SortHeader label="Title" active={sortKey() === 'title'} dir={sortDir()} onClick={() => toggleSort('title')} />
                        <SortHeader label="Updated" class="resource-table-col-timestamp" active={sortKey() === 'updatedAt'} dir={sortDir()} onClick={() => toggleSort('updatedAt')} />
                        <Show when={props.actions}><th class="resource-table-col-actions"></th></Show>
                    </tr>
                </thead>
                <tbody>
                    <For each={sorted()} fallback={
                        <tr><td colSpan={4} class="resource-table-empty">No chats yet</td></tr>
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
        </div>
    )
}
