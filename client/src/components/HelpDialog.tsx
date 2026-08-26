import { createEffect, createSignal, For, Show, type JSXElement } from 'solid-js'
import { MdFillChevron_left, MdFillChevron_right } from 'solid-icons/md'
import { viewport } from '../viewport'
import { useModal } from './Modal'
import { usePreferences } from './PreferencesDialog'
import { useAssetPickers } from './chat/AssetPicker'
import { Text } from './typography/Text'
import { DOCS, findDoc, parseDocRef, renderDoc, type DocRef } from '../docs'

/**
 * Schemes that execute if a click ever reaches the browser. The catch-all
 * `preventDefault` at the end of the click handler already stops them, but that
 * protects by falling through - one reordered branch and they are live.
 */
const BLOCKED_SCHEME = /^\s*(javascript|data|vbscript):/i

const DOC_ACTION_PREFIX = 'app:'

export function HelpDialog(props: { initial?: DocRef }) {
    const preferences = usePreferences()
    const pickers = useAssetPickers()

    /**
     * What `[text](app:name)` in a doc may do. The whole segment after the
     * prefix is the key - nothing is parsed out of it and there are no
     * arguments, so a link can only ever name one of these.
     *
     * Openers only. A doc link that wrote a setting would be a side effect of
     * reading documentation, with nothing to confirm it and no way back.
     */
    const docActions: Record<string, () => void> = {
        preferences: () => preferences.open(),
        setPlayerActor: () => pickers.openPlayerCharacter(),
    }

    const initial = () => parseDocRef(props.initial ?? DOCS[0]?.slug ?? '')

    const [slug, setSlug] = createSignal<string | null>(
        props.initial ? initial().slug : (viewport() === 'phone' ? null : DOCS[0]?.slug ?? null)
    )
    // A fresh object per request, so clicking the same anchor twice still
    // scrolls. Comparing by reference is what makes a repeat click count.
    const [anchor, setAnchor] = createSignal<{ target?: string }>({ target: initial().anchor })

    const isPhone = () => viewport() === 'phone'
    const doc = () => (slug() ? findDoc(slug()!) : undefined)
    const html = () => {
        const d = doc()
        return d ? renderDoc(d.markdown) : ''
    }

    let contentRef: HTMLDivElement | undefined

    // Nothing is written back to `anchor` here. Clearing it from inside the
    // effect re-entered on the same tracked read, and the second pass had no
    // target left, so it reset the scroll it had just done.
    createEffect(() => {
        html()
        const { target } = anchor()
        if (!contentRef) return
        queueMicrotask(() => {
            if (!contentRef) return
            const el = target ? contentRef.querySelector(`#${CSS.escape(target)}`) : null
            if (el) el.scrollIntoView({ block: 'start' })
            else contentRef.scrollTop = 0
            if (import.meta.env.DEV && target && !el) {
                console.warn(`[docs] ${slug()}.md has no heading anchor "#${target}"`)
            }
        })
    })

    const go = (ref: DocRef) => {
        const { slug: next, anchor: hash } = parseDocRef(ref)
        setSlug(next)
        setAnchor({ target: hash })
    }

    const onContentClick = (e: MouseEvent) => {
        const link = (e.target as HTMLElement | null)?.closest('a')
        if (!link) return
        const href = link.getAttribute('href') ?? ''

        if (BLOCKED_SCHEME.test(href)) {
            e.preventDefault()
            return
        }

        // Before the `#` branch: an anchor can never contain `:` (slugify
        // strips it), so the two can't be confused.
        if (href.startsWith(DOC_ACTION_PREFIX)) {
            e.preventDefault()
            const name = href.slice(DOC_ACTION_PREFIX.length)
            const run = Object.prototype.hasOwnProperty.call(docActions, name)
                ? docActions[name]
                : undefined
            if (run) run()
            else if (import.meta.env.DEV) {
                console.warn(`[docs] no doc action named "${name}"`)
            }
            return
        }

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

/** `to` is a page slug with an optional heading: `"actors#description"`. */
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
