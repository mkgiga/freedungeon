import { createEffect, createMemo, createSignal, For, onCleanup, Show } from 'solid-js'
import { MdFillDownload } from 'solid-icons/md'
import { Portal } from 'solid-js/web'
import { state } from '../state'
import { trpc } from '../trpc'
import { isBlocking, type DependencyState } from '@shared/dependencies'
import { Heading } from './typography/Heading'
import { Text } from './typography/Text'
import { useModal } from './Modal'
import { useToast } from './Toast'

/**
 * Blocks the app while a required external file is being fetched.
 *
 * Driven entirely by the replicated `state.dependencies` map — the same one-way
 * flow as ActivityOverlay. The client never polls; the server publishes
 * progress and this re-renders. Mounted at the app shell rather than inside a
 * route so it covers every tab.
 *
 * A failed download keeps the overlay up with Retry/Cancel rather than
 * vanishing, because the action that triggered it (saving an Anthropic config,
 * enabling background removal) is refused when the dependency can't be met —
 * silently dismissing would leave the user wondering why nothing saved.
 */
export function PatcherOverlay() {
    const blocking = createMemo(() =>
        Object.values(state.dependencies ?? {}).filter(isBlocking),
    )

    const toast = useToast()
    const [minimized, setMinimized] = createSignal(false)
    createEffect(() => { if (blocking().length === 0) setMinimized(false) })

    const overall = createMemo(() => {
        let received = 0
        let total = 0
        for (const dep of blocking()) {
            if (!dep.total) continue
            received += dep.received ?? 0
            total += dep.total
        }
        return total > 0 ? Math.min(100, Math.round((received / total) * 100)) : null
    })

    const failed = createMemo(() => blocking().filter(d => d.status === 'failed'))

    const reported = new Set<string>()
    createEffect(() => {
        if (!minimized()) return
        for (const dep of failed()) {
            if (reported.has(dep.key)) continue
            reported.add(dep.key)
            toast({
                type: 'error',
                title: `${dep.label} failed`,
                message: dep.error ?? 'The download stopped.',
                duration: 0,
                action: { label: 'Open downloads', kind: 'openDownloads' },
            })
        }
        for (const key of [...reported]) {
            if (!failed().some(d => d.key === key)) reported.delete(key)
        }
    })

    const minimize = () => setMinimized(true)

    return (
        <Show when={blocking().length > 0 && !minimized()}>
            <Portal>
                <div class="patcher-overlay">
                    <div class="patcher-panel">
                        <Heading level={2}>Downloading required files</Heading>
                        <For each={blocking()}>{(dep) => <PatcherRow dep={dep} />}</For>

                        <Show when={blocking().every(d => d.status === 'downloading')}>
                            <div class="patcher-actions">
                                <button class="modal-btn modal-btn-cancel" onClick={minimize}>
                                    Continue in background
                                </button>
                            </div>
                        </Show>
                    </div>
                </div>
            </Portal>
        </Show>
    )
}

function PatcherRow(props: { dep: DependencyState }) {
    const pct = () => {
        const { received, total } = props.dep
        if (!total || !received) return null
        return Math.min(100, Math.round((received / total) * 100))
    }

    return (
        <div class="patcher-row">
            <Text>{props.dep.label}</Text>
            <Text size="sm" class="patcher-reason">{props.dep.reason}</Text>

            <Show when={props.dep.status === 'downloading'}>
                <div class="patcher-progress">
                    <div
                        class="patcher-progress-fill"
                        classList={{ indeterminate: pct() === null }}
                        style={pct() !== null ? { width: `${pct()}%` } : undefined}
                    />
                </div>
                <Text size="sm" class="patcher-bytes">
                    {pct() !== null ? `${pct()}% — ${mb(props.dep.received)} of ${mb(props.dep.total)}` : mb(props.dep.received)}
                </Text>
            </Show>

            <Show when={props.dep.status === 'unauthenticated'}>
                <Text size="sm">
                    Downloaded, but no Claude account is connected. Signing in here signs you
                    in to Claude Code generally.
                </Text>
                <div class="patcher-actions">
                    <button class="modal-btn modal-btn-confirm" onClick={() => trpc.dependencies.signIn.mutate()}>
                        Sign in to Claude
                    </button>
                    <button
                        class="modal-btn modal-btn-cancel"
                        onClick={() => trpc.dependencies.dismiss.mutate({ key: props.dep.key })}
                    >
                        Not now
                    </button>
                </div>
            </Show>

            <Show when={props.dep.status === 'authenticating'}>
                <SignInFlow dep={props.dep} />
            </Show>

            <Show when={props.dep.status === 'failed'}>
                <Text size="sm" class="patcher-error">{props.dep.error ?? 'Download failed.'}</Text>
                <div class="patcher-actions">
                    <button
                        class="modal-btn modal-btn-confirm"
                        onClick={() => trpc.dependencies.ensure.mutate({ key: props.dep.key })}
                    >
                        Retry
                    </button>
                    <button
                        class="modal-btn modal-btn-cancel"
                        onClick={() => trpc.dependencies.dismiss.mutate({ key: props.dep.key })}
                    >
                        Cancel
                    </button>
                </div>
            </Show>
        </div>
    )
}

function SignInFlow(props: { dep: DependencyState }) {
    const [code, setCode] = createSignal('')

    return (
        <>
            <Show when={props.dep.authUrl} fallback={<Text size="sm">Starting sign-in…</Text>}>
                {(url) => (
                    <>
                        <Text size="sm">A browser should have opened. If not, use this link:</Text>
                        <a class="patcher-link" href={url()} target="_blank" rel="noreferrer noopener">{url()}</a>
                    </>
                )}
            </Show>

            <Show when={props.dep.awaitingCode}>
                <Text size="sm">Got a code instead? Paste it:</Text>
                <form
                    class="patcher-code"
                    onSubmit={(e) => {
                        e.preventDefault()
                        if (!code().trim()) return
                        trpc.dependencies.submitAuthCode.mutate({ code: code() })
                        setCode('')
                    }}
                >
                    <input
                        class="patcher-code-input"
                        value={code()}
                        onInput={(e) => setCode(e.currentTarget.value)}
                        placeholder="Paste code"
                        autocomplete="off"
                        spellcheck={false}
                    />
                    <button class="modal-btn modal-btn-confirm" type="submit">Submit</button>
                </form>
            </Show>

            <div class="patcher-actions">
                <button class="modal-btn modal-btn-cancel" onClick={() => trpc.dependencies.cancelSignIn.mutate()}>
                    Cancel
                </button>
            </div>
        </>
    )
}

function mb(bytes: number | undefined): string {
    if (!bytes) return '0 MB'
    return `${(bytes / 1e6).toFixed(1)} MB`
}

/**
 * Live progress for a backgrounded download, opened from the system menu.
 *
 * A dialog rather than a side rail panel: on a wide screen the nav is already a
 * 200px column, and a second one beside it puts 520px of chrome in front of the
 * content. Exported as a hook so the menu can also read whether there is
 * anything to show, and label its own row with the percentage.
 */
export function useDownloads() {
    const modal = useModal()
    const blocking = createMemo(() =>
        Object.values(state.dependencies ?? {}).filter(isBlocking))

    const overall = () => {
        let received = 0, total = 0
        for (const dep of blocking()) {
            if (!dep.total) continue
            received += dep.received ?? 0
            total += dep.total
        }
        return total > 0 ? Math.min(100, Math.round((received / total) * 100)) : null
    }

    return {
        active: () => blocking().length > 0,
        summary: () => blocking().some(d => d.status === 'failed')
            ? 'failed'
            : overall() === null ? null : `${overall()}%`,
        open: () => modal.open({
            title: 'Active downloads',
            content: () => (
                <div class="patcher-panel-body">
                    <For each={blocking()}>{(dep) => <PatcherRow dep={dep} />}</For>
                    <Show when={blocking().length === 0}>
                        <Text size="sm" class="settings-hint">Nothing downloading.</Text>
                    </Show>
                </div>
            ),
        }),
    }
}
