import { createEffect, createResource, createSignal, For, Show } from 'solid-js'
import { MdFillBuild, MdFillSend, MdFillSettings, MdFillSmart_toy } from 'solid-icons/md'
import { trpc } from '../../trpc'
import { Text } from '../typography/Text'
import { Em } from '../typography/Em'
import { Loader } from '../Loader'
import { useScenarioAgentSettings } from './ScenarioAgentSettings'

type ToolCall = { name: string; args: Record<string, unknown>; result?: string; error?: string }
type Message = { id: string; role: string; content: string; createdAt: number; toolCalls?: ToolCall[] }

/**
 * What the agent did, inline with what it said.
 *
 * Without this the panel reports "done" and the scenario silently differs —
 * you can't tell a created character from a renamed one, or notice a call that
 * failed. Collapsed by default: the summary line is the answer most of the
 * time, and the arguments matter only when something looks wrong.
 */
function ToolCallList(props: { calls: ToolCall[] }) {
    // Most tools take the thing they act on as `name`, `title` or `id`; showing
    // it turns "create_character" into "create_character  Thrall".
    const subject = (call: ToolCall) => {
        for (const key of ['name', 'title', 'id', 'query', 'url']) {
            const v = call.args?.[key]
            if (typeof v === 'string' && v) return v
        }
        return null
    }

    return (
        <div class="collab-tools">
            <For each={props.calls}>
                {(call) => (
                    <details class="collab-tool" classList={{ 'is-error': Boolean(call.error) }}>
                        <summary>
                            <MdFillBuild size={13} />
                            <span class="collab-tool-name">{call.name}</span>
                            <Show when={subject(call)}>
                                {(s) => <span class="collab-tool-subject">{s()}</span>}
                            </Show>
                        </summary>
                        <pre class="collab-tool-body">{JSON.stringify(call.args, null, 2)}</pre>
                        <Show when={call.error ?? call.result}>
                            {(out) => (
                                <pre class="collab-tool-body collab-tool-output">{out()}</pre>
                            )}
                        </Show>
                    </details>
                )}
            </For>
        </div>
    )
}

/**
 * The Scenario collaborator conversation.
 *
 * One component for both layouts: the desktop side panel and the mobile
 * screen render this with different chrome around it. The conversation lives in
 * its own chat row (`kind: 'collaborator'`), so it persists across reloads and
 * never appears in the recent-chats list.
 */
export function ScenarioCollaborator(props: {
    scenarioId: string
    /** The docked panel has no chrome of its own; the phone screen has a TopBar
     *  above it already, so it asks for this to stay off. */
    showHeader?: boolean
}) {
    const openSettings = useScenarioAgentSettings()
    const [conversationId, setConversationId] = createSignal<string | null>(null)
    const [messages, setMessages] = createSignal<Message[]>([])
    const [draft, setDraft] = createSignal('')
    const [busy, setBusy] = createSignal(false)
    const [error, setError] = createSignal<string | null>(null)
    let scroller: HTMLDivElement | undefined

    // The conversation is created on first open and reused thereafter.
    const [conversation] = createResource(
        () => props.scenarioId,
        async (scenarioId) => {
            const { id } = await trpc.scenarioAgent.ensureConversation.mutate({ scenarioId })
            setConversationId(id)
            const history = await trpc.scenarioAgent.history.query({ conversationId: id })
            setMessages(history as Message[])
            return id
        },
    )

    // Follow the tail as turns land.
    createEffect(() => {
        messages()
        queueMicrotask(() => scroller?.scrollTo({ top: scroller.scrollHeight }))
    })

    const send = async () => {
        const text = draft().trim()
        const id = conversationId()
        if (!text || !id || busy()) return

        setBusy(true)
        setError(null)
        setDraft('')
        // Optimistic echo so the input clearing doesn't look like a dropped message.
        const pending: Message = { id: `pending-${Date.now()}`, role: 'user', content: text, createdAt: Date.now() }
        setMessages([...messages(), pending])

        try {
            const result = await trpc.scenarioAgent.send.mutate({
                scenarioId: props.scenarioId,
                conversationId: id,
                message: text,
            })
            // Replace the optimistic echo with the rows the server actually wrote.
            setMessages([...messages().filter(m => m.id !== pending.id), ...(result.messages as Message[])])
        } catch (err) {
            setMessages(messages().filter(m => m.id !== pending.id))
            setDraft(text)
            setError(err instanceof Error ? err.message : String(err))
        } finally {
            setBusy(false)
        }
    }

    return (
        <div class="collab">
            <Show when={props.showHeader}>
                <header class="collab-header">
                    <Text size="sm"><Em semibold>Collaborator</Em></Text>
                    <button class="collab-settings" onClick={openSettings} title="Collaborator settings">
                        <MdFillSettings size={18} />
                    </button>
                </header>
            </Show>
            <div class="collab-messages" ref={scroller}>
                <Show when={!conversation.loading} fallback={<div class="collab-loading"><Loader size={20} /></div>}>
                    <Show
                        when={messages().length > 0}
                        fallback={
                            <div class="collab-intro">
                                <MdFillSmart_toy size={28} class="opacity-40" />
                                <Text size="sm" class="opacity-60">
                                    Ask for characters, descriptions, notes. It only sees this scenario.
                                </Text>
                            </div>
                        }
                    >
                        <For each={messages()}>
                            {(message) => (
                                <div class="collab-message" classList={{ 'is-user': message.role === 'user' }}>
                                    <Show when={message.toolCalls?.length}>
                                        <ToolCallList calls={message.toolCalls!} />
                                    </Show>
                                    <Show when={message.content}>
                                        <Text size="sm">{message.content}</Text>
                                    </Show>
                                </div>
                            )}
                        </For>
                    </Show>
                    <Show when={busy()}>
                        <div class="collab-message collab-thinking">
                            <Loader size={16} />
                            <Text size="sm" class="opacity-60">Working…</Text>
                        </div>
                    </Show>
                </Show>
            </div>

            <Show when={error()}>
                <Text size="sm" class="collab-error">{error()}</Text>
            </Show>

            <form
                class="collab-composer"
                onSubmit={(e) => { e.preventDefault(); send() }}
            >
                <textarea
                    class="collab-input"
                    value={draft()}
                    placeholder="Ask for a character, a note, an idea…"
                    rows={1}
                    disabled={busy() || conversation.loading}
                    onInput={(e) => setDraft(e.currentTarget.value)}
                    onKeyDown={(e) => {
                        // Enter sends; Shift+Enter is a newline, matching the main composer.
                        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
                    }}
                />
                <button type="submit" class="collab-send" disabled={busy() || !draft().trim()} title="Send">
                    <MdFillSend size={20} />
                </button>
            </form>
        </div>
    )
}
