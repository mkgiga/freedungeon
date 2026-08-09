import { marked, type Tokens } from 'marked'

/**
 * The help content, loaded from the repo's `/docs` directory at build time.
 *
 * Bundled rather than fetched. This app runs offline — local models are a
 * first-class option — and documentation that needs the internet is missing
 * exactly when someone is offline working out why their endpoint won't
 * connect. Bundling also pins the docs to the build, so a v1 binary can't show
 * you v2 instructions.
 *
 * The markdown files stay the single source: publish the same `/docs` folder
 * anywhere else and both renderings come from identical text.
 */
const RAW = import.meta.glob('../../docs/*.md', {
    query: '?raw',
    import: 'default',
    eager: true,
}) as Record<string, string>

/**
 * Reading order. Anything not listed still shows up, alphabetically, after
 * these — a doc added to the folder appears without needing a code change,
 * it just won't have an opinion about where it belongs.
 */
const ORDER = ['install', 'chats', 'actors', 'notes', 'macros', 'configuration']

export type Doc = {
    slug: string
    title: string
    markdown: string
}

/**
 * GitHub's heading-anchor rules: lowercase, drop punctuation, spaces to
 * hyphens. Matching them matters because the docs link to each other with
 * anchors like `actors.md#description`, and those same links have to work when
 * the folder is rendered by GitHub or a static site — one slug scheme, three
 * renderers.
 */
export function slugify(text: string): string {
    return text.trim().toLowerCase().replace(/[^\w\s-]/g, '').replace(/\s+/g, '-')
}

/** First `# Heading`, falling back to a prettified filename. */
function titleOf(slug: string, markdown: string): string {
    const heading = markdown.match(/^#\s+(.+)$/m)?.[1]?.trim()
    if (heading) return heading
    return slug.charAt(0).toUpperCase() + slug.slice(1).replace(/-/g, ' ')
}

export const DOCS: Doc[] = Object.entries(RAW)
    .map(([path, markdown]) => {
        const slug = path.split('/').pop()!.replace(/\.md$/, '')
        return { slug, title: titleOf(slug, markdown), markdown }
    })
    // A file that exists but hasn't been written yet would render as a blank
    // page, which reads as a bug rather than as a gap. It appears on its own
    // once it has content.
    .filter(doc => doc.markdown.trim().length > 0)
    .sort((a, b) => {
        const ai = ORDER.indexOf(a.slug)
        const bi = ORDER.indexOf(b.slug)
        if (ai !== -1 && bi !== -1) return ai - bi
        if (ai !== -1) return -1
        if (bi !== -1) return 1
        return a.slug.localeCompare(b.slug)
    })

export function findDoc(slug: string): Doc | undefined {
    return DOCS.find(d => d.slug === slug)
}

// Headings carry ids so in-page anchors resolve — both the docs' own
// cross-links and any UI label pointing at a specific section. marked stopped
// emitting them by default, so we add them from the heading's plain text
// rather than its rendered HTML (which would fold markup into the slug).
marked.use({
    renderer: {
        heading(this: { parser: { parseInline: (t: Tokens.Generic[]) => string } }, token: Tokens.Heading) {
            const inner = this.parser.parseInline(token.tokens)
            return `<h${token.depth} id="${slugify(token.text)}">${inner}</h${token.depth}>\n`
        },
    },
})

/** Markdown to HTML. Content is first-party and ships with the build. */
export function renderDoc(markdown: string): string {
    return marked.parse(markdown, { async: false })
}

/**
 * A pointer into the docs: `"notes"` or `"actors#description"`.
 * Used by the help dialog and by any label that links into it.
 */
export type DocRef = string

export function parseDocRef(ref: DocRef): { slug: string; anchor?: string } {
    const [slug, anchor] = ref.split('#')
    return { slug: slug ?? '', anchor: anchor || undefined }
}
