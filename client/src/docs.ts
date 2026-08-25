import { marked, type Tokens } from 'marked'

const RAW = import.meta.glob('../../docs/*.md', {
    query: '?raw',
    import: 'default',
    eager: true,
}) as Record<string, string>

const ORDER = ['install', 'chats', 'actors', 'notes', 'macros', 'configuration']

export type Doc = {
    slug: string
    title: string
    markdown: string
}

/**
 * GitHub's heading-anchor rules: lowercase, drop punctuation, spaces to hyphens.
 * Must match - the same `actors.md#description` links have to resolve when the
 * folder is rendered by GitHub or a static site.
 */
export function slugify(text: string): string {
    return text.trim().toLowerCase().replace(/[^\w\s-]/g, '').replace(/\s+/g, '-')
}

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

marked.use({
    renderer: {
        heading(this: { parser: { parseInline: (t: Tokens.Generic[]) => string } }, token: Tokens.Heading) {
            const inner = this.parser.parseInline(token.tokens)
            return `<h${token.depth} id="${slugify(token.text)}">${inner}</h${token.depth}>\n`
        },
    },
})

export function renderDoc(markdown: string): string {
    return marked.parse(markdown, { async: false })
}

export type DocRef = string

export function parseDocRef(ref: DocRef): { slug: string; anchor?: string } {
    const [slug, anchor] = ref.split('#')
    return { slug: slug ?? '', anchor: anchor || undefined }
}
