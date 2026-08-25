/**
 * Strips comments from the TypeScript sources. Keeps toolchain directives and
 * JSDoc on exported declarations.
 *
 *   bun scripts/strip-comments.ts --dry-run   report only
 *   bun scripts/strip-comments.ts             rewrite in place
 *   bun scripts/strip-comments.ts --all       also drop JSDoc on exports
 *
 * Walks AST nodes rather than scanning tokens: `/*` inside JSX text is literal
 * text, not a comment. Only sees tracked files. Each file's AST is compared
 * before and after and a mismatch skips the file rather than writing it.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'

// The root workspace has no dependencies of its own; typescript belongs to the
// client. Resolved from there rather than added to the root, so a maintenance
// script doesn't put a compiler in the repo's dependency list.
const ts: typeof import('typescript') =
    createRequire(new URL('../client/package.json', import.meta.url))('typescript')

/** Comments the toolchain reads as instructions. Removing one changes what the
 *  code does, so they are never prose and never eligible. */
const DIRECTIVE =
    /@ts-|eslint-|tslint:|prettier-ignore|@vite-ignore|webpackChunk|^\/\/\/\s*<reference|@license|@preserve|sourceMappingURL|@__PURE__|c8 ignore|istanbul|@jsx|use strict/

const dryRun = process.argv.includes('--dry-run')
const stripExportDocs = process.argv.includes('--all')

type Range = { pos: number; end: number }

function sourceFile(path: string, text: string) {
    return ts.createSourceFile(
        path,
        text,
        ts.ScriptTarget.Latest,
        /* setParentNodes */ true,
        path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    )
}

/**
 * A shape that survives losing comments, so two versions of a file can be
 * compared for real difference.
 *
 * Two JSX allowances: comment-only expression containers are elided, and
 * adjacent text is accumulated rather than counted per node - removing a
 * container merges the text either side of it. Neither can hide a real change.
 */
function signature(sf: ts.SourceFile): string[] {
    const out: string[] = []
    let jsxText = ''
    const flush = () => {
        const t = jsxText.replace(/\s+/g, ' ').trim()
        if (t) out.push(`jsx:${t}`)
        jsxText = ''
    }
    const visit = (node: ts.Node) => {
        if (node.kind === ts.SyntaxKind.JsxText) {
            jsxText += (node as ts.JsxText).text
            return
        }
        if (ts.isJsxExpression(node) && !node.expression) return
        flush()
        out.push(String(node.kind))
        if (node.getChildCount(sf) === 0) out.push(node.getText(sf))
        node.forEachChild(visit)
    }
    sf.forEachChild(visit)
    flush()
    return out
}

function exportedDocRanges(sf: ts.SourceFile, text: string): Set<string> {
    const keep = new Set<string>()
    if (stripExportDocs) return keep

    const isExported = (node: ts.Node) =>
        ts.canHaveModifiers(node) &&
        ts.getModifiers(node)?.some(m => m.kind === ts.SyntaxKind.ExportKeyword)

    const visit = (node: ts.Node) => {
        if (isExported(node) || ts.isExportAssignment(node)) {
            for (const r of ts.getLeadingCommentRanges(text, node.pos) ?? []) {
                if (text.slice(r.pos, r.pos + 3) === '/**') keep.add(`${r.pos}:${r.end}`)
            }
        }
        node.forEachChild(visit)
    }
    sf.forEachChild(visit)
    return keep
}

function commentRanges(sf: ts.SourceFile, text: string, keep: Set<string>): Range[] {
    const found = new Map<string, Range>()

    const consider = (r: ts.CommentRange) => {
        const key = `${r.pos}:${r.end}`
        if (found.has(key) || keep.has(key)) return
        if (DIRECTIVE.test(text.slice(r.pos, r.end))) return
        found.set(key, { pos: r.pos, end: r.end })
    }

    const visit = (node: ts.Node) => {
        // A node's leading trivia is scanned from the end of the previous token.
        // Inside JSX that previous token can be markup text, where `/*` is not a
        // comment at all — so these nodes are left alone and their real comments
        // are reached through the expression containers below.
        if (node.kind !== ts.SyntaxKind.JsxText) {
            for (const r of ts.getLeadingCommentRanges(text, node.pos) ?? []) consider(r)
            for (const r of ts.getTrailingCommentRanges(text, node.end) ?? []) consider(r)
        }
        // `{/* … */}` is an expression container holding nothing. Deleting only
        // the comment would leave a bare `{}` behind, so the whole node goes.
        if (ts.isJsxExpression(node) && !node.expression) {
            found.set(`jsx:${node.pos}`, { pos: node.getStart(sf), end: node.end })
        }
        node.forEachChild(visit)
    }
    sf.forEachChild(visit)

    return [...found.values()].sort((a, b) => a.pos - b.pos)
}

/**
 * Widen a range to swallow the line it sits on, when nothing else is on it.
 * Without this every removed comment leaves an indented blank line behind.
 */
function widenToWholeLines(text: string, r: Range): Range {
    let { pos, end } = r

    let lineStart = pos
    while (lineStart > 0 && text[lineStart - 1] !== '\n') lineStart--
    const before = text.slice(lineStart, pos)

    let after = end
    while (after < text.length && (text[after] === ' ' || text[after] === '\t')) after++

    if (/^\s*$/.test(before) && (after >= text.length || text[after] === '\n' || text[after] === '\r')) {
        // The comment owns the line: take the indent and the line break too.
        pos = lineStart
        end = after
        if (text[end] === '\r') end++
        if (text[end] === '\n') end++
    } else {
        // Trailing comment after code — leave the line, drop the gap before it.
        while (pos > lineStart && (text[pos - 1] === ' ' || text[pos - 1] === '\t')) pos--
        end = after
    }
    return { pos, end }
}

function merge(ranges: Range[]): Range[] {
    const out: Range[] = []
    for (const r of ranges) {
        const last = out[out.length - 1]
        if (last && r.pos <= last.end) last.end = Math.max(last.end, r.end)
        else out.push({ ...r })
    }
    return out
}

function strip(path: string, text: string): { next: string; removed: number } | null {
    const sf = sourceFile(path, text)
    const ranges = commentRanges(sf, text, exportedDocRanges(sf, text))
    if (ranges.length === 0) return null

    const widened = merge(ranges.map(r => widenToWholeLines(text, r)))

    let next = text
    for (let i = widened.length - 1; i >= 0; i--) {
        next = next.slice(0, widened[i]!.pos) + next.slice(widened[i]!.end)
    }
    // Two statements separated by a blank line, a comment, and another blank
    // line come out with a double gap. Collapse those; leave single ones.
    // The line break is captured rather than written literally — this repo's
    // working tree is a mix of LF and CRLF, and a hardcoded \n would silently
    // convert whichever files it touched.
    next = next.replace(/(\r?\n)[ \t]*\r?\n([ \t]*\r?\n)+/g, '$1$1')

    return { next, removed: ranges.length }
}

const files = execFileSync('git', ['ls-files', '*.ts', '*.tsx'], { encoding: 'utf8' })
    .trim()
    .split('\n')
    .filter(f => f && !f.includes('node_modules') && !f.endsWith('.gen.ts'))

let changed = 0
let removed = 0
let before = 0
let after = 0
const skipped: string[] = []

for (const path of files) {
    const text = readFileSync(path, 'utf8')
    const result = strip(path, text)
    if (!result) continue

    const a = signature(sourceFile(path, text))
    const b = signature(sourceFile(path, result.next))
    if (a.length !== b.length || a.some((v, i) => v !== b[i])) {
        skipped.push(path)
        continue
    }

    changed++
    removed += result.removed
    before += text.length
    after += result.next.length
    if (!dryRun) writeFileSync(path, result.next)
}

const mode = dryRun ? 'would remove' : 'removed'
console.log(`${mode} ${removed} comments across ${changed} of ${files.length} files`)
console.log(`${(before / 1024).toFixed(0)}kb -> ${(after / 1024).toFixed(0)}kb (-${(100 - (after / before) * 100).toFixed(1)}%)`)
if (skipped.length) {
    console.log(`\nskipped ${skipped.length} — AST changed, left untouched:`)
    for (const f of skipped) console.log(`  ${f}`)
}
