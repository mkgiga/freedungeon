import { createEffect, createSignal, For, Show, type JSXElement } from 'solid-js'
import { MdFillChevron_left, MdFillChevron_right } from 'solid-icons/md'
import { viewport } from '../viewport'
import { useModal } from './Modal'
import { Text } from './typography/Text'
import { DOCS, findDoc, parseDocRef, renderDoc, type DocRef } from '../docs'

/**
 * The help browser: the `/docs` folder, rendered.
 *
 * Same list-and-detail shape as the models library, so the two read as the same
 * kind of surface. Opening it can target a specific page and heading, which is
 * what lets a label anywhere in the app point at the paragraph that explains it
 * (see DocLink).
 */
export function HelpDialog(props: { initial?: DocRef }) {
    const initial = () => parseDocRef(props.initial ?? DOCS[0]?.slug ?? '')

    const [slug, setSlug] = createSignal<string | null>(
        props.initial ? initial().slug : (viewport() === 'phone' ? null : DOCS[0]?.slug ?? null)
    )
    const [anchor, setAnchor] = createSignal<string | undefined>(initial().anchor)

    const isPhone = () => viewport() === 'phone'
    const doc = () => (slug() ? findDoc(slug()!) : undefined)
    const html = () => {
        const d = doc()
        return d ? renderDoc(d.markdown) : ''
    }

    let contentRef: HTMLDivElement | undefined

    createEffect(() => {
        html()
        const target = anchor()
        if (!contentRef) return
        queueMicrotask(() => {
            if (!contentRef) return
            if (!target) { contentRef.scrollTop = 0; return }
            const el = contentRef.querySelector(`#${CSS.escape(target)}`)
            if (el) el.scrollIntoView({ block: 'start' })
            else contentRef.scrollTop = 0
            setAnchor(undefined)
        })
    })

    const go = (ref: DocRef) => {
        const { slug: next, anchor: hash } = parseDocRef(ref)
        setSlug(next)
        setAnchor(hash)
    }

    const onContentClick = (e: MouseEvent) => {
        const link = (e.target as HTMLElement | null)?.closest('a')
        if (!link) return
        const href = link.getAttribute('href') ?? ''

        if (href.startsWith('#')) {
            e.preventDefault()
            go(`${slug()}#${href.slice(1)}`)
            return
        }
        const internal = href.match(/^([\w.-]+)\.md(?:#(.*))?$/)
        if (internal) {
            e.preventDefault()
            go(internal[2] ? `${internal[1]}#${internal[2]}` : internal[1]!)
            return
        }
        if (/^https?:\/\//.test(href)) {
            e.preventDefault()
            window.open(href, '_blank', 'noopener,noreferrer')
            return
        }
        e.preventDefault()
    }

    const showList = () => !isPhone() || slug() === null
    const showPane = () => !isPhone() || slug() !== null

    return (
        <div class="rail-dialog">
            <Show when={showList()}>
                <nav class="rail-dialog-rail">
                    <div class="rail-dialog-items">
                        <For each={DOCS} fallback={
                            <Text size="sm" class="settings-hint p-3">No documentation bundled.</Text>
                        }>
                            {(entry) => (
                                <button
                                    type="button"
                                    class="rail-dialog-item"
                                    classList={{ active: !isPhone() && slug() === entry.slug }}
                                    onClick={() => go(entry.slug)}
                                >
                                    <span class="rail-dialog-item-text">
                                        <Text class="rail-dialog-item-label">{entry.title}</Text>
                                    </span>
                                    <Show when={isPhone()}>
                                        <MdFillChevron_right size={20} class="rail-dialog-item-chevron" />
                                    </Show>
                                </button>
                            )}
                        </For>
                    </div>
                    <div class="rail-dialog-rail-footer doc-version">
                        <Text size="sm" font="mono">v{__APP_VERSION__}</Text>
                    </div>
                </nav>
            </Show>

            <Show when={showPane()}>
                <div class="rail-dialog-pane">
                    <Show when={isPhone() && doc()}>
                        {(entry) => (
                            <button type="button" class="rail-dialog-back" onClick={() => setSlug(null)}>
                                <MdFillChevron_left size={20} />
                                <Text>{entry().title}</Text>
                            </button>
                        )}
                    </Show>
                    <div class="doc-content" ref={contentRef} onClick={onContentClick}>
                        <Show
                            when={doc()}
                            fallback={<Text size="sm" class="settings-hint">Pick a page.</Text>}
                        >
                            <div innerHTML={html()} />
                        </Show>
                    </div>
                </div>
            </Show>
        </div>
    )
}

/** Opens the help browser, optionally at a page and heading. */
export function useHelp() {
    const modal = useModal()
    return {
        open: (ref?: DocRef) => modal.open({
            title: 'Help',
            fullscreen: true,
            content: () => <HelpDialog initial={ref} />,
        }),
    }
}

/**
 * A term that explains itself: renders its own text as a quiet link into the
 * docs, the way a wiki links a word the reader may not know.
 *
 * `to` is a page slug with an optional heading — `"notes"`, `"actors#description"`.
 */
export function DocLink(props: { to: DocRef; children: JSXElement }) {
    const help = useHelp()

    if (import.meta.env.DEV) {
        const { slug } = parseDocRef(props.to)
        if (!findDoc(slug)) {
            console.warn(`[docs] DocLink points at "${props.to}" but there is no docs/${slug}.md`)
        }
    }

    return (
        <button
            type="button"
            class="doc-link"
            onClick={(e) => { e.stopPropagation(); help.open(props.to) }}
        >
            {props.children}
        </button>
    )
}
