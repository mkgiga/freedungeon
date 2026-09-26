import fs from 'node:fs'
import path from 'node:path'
import { Hono } from 'hono'
import { installFromZipBytes, resolveExtensionFile } from '../../extensions/host'
import { log } from '../../logger'

/**
 * Installing has its own route rather than a tRPC procedure: the payload is an
 * archive, and base64-ing a zip through JSON would inflate it by a third for
 * no gain. Mirrors how image uploads already work.
 *
 * The same route serves an active extension's own files back to the page, so
 * its browser entry - and anything that entry imports - can be fetched.
 */
export const extensionUploadRouter = new Hono()

extensionUploadRouter.post('/', async (c) => {
    const formData = await c.req.formData()
    const file = formData.get('file') as File | null
    if (!file) return c.json({ error: 'No file provided' }, 400)
    if (!file.name.toLowerCase().endsWith('.zip')) {
        return c.json({ error: 'Extensions are installed from a .zip archive' }, 400)
    }

    try {
        const info = await installFromZipBytes(new Uint8Array(await file.arrayBuffer()))
        return c.json({ id: info.manifest.id, name: info.manifest.name })
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        log.server.warn(`Extension install failed: ${message}`)
        return c.json({ error: message }, 400)
    }
})

const MEDIA_TYPES: Record<string, string> = {
    '.js': 'text/javascript',
    '.mjs': 'text/javascript',
    '.ts': 'text/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.woff2': 'font/woff2',
}

const transpiler = new Bun.Transpiler({ loader: 'ts' })

/**
 * TypeScript is transpiled on the way out, so an extension needs no build
 * step in the browser any more than it does on the server. Import specifiers
 * are left alone: a relative import writes the real filename (`./dice.ts`) and
 * lands back here, which is also why nothing has to be bundled.
 */
extensionUploadRouter.get('/:id/*', async (c) => {
    const id = c.req.param('id')
    const rel = c.req.path.slice(`/extensions/${id}/`.length)

    const file = resolveExtensionFile(id, rel)
    if (!file) return c.text('Not found', 404)

    const ext = path.extname(file).toLowerCase()
    const type = MEDIA_TYPES[ext] ?? 'application/octet-stream'

    if (ext === '.ts') {
        try {
            const source = fs.readFileSync(file, 'utf8')
            return c.body(transpiler.transformSync(source), 200, { 'content-type': type })
        } catch (err) {
            log.server.warn(`[ext:${id}] could not transpile ${rel}: ${err}`)
            return c.text('Could not transpile', 500)
        }
    }

    return new Response(Bun.file(file), { headers: { 'content-type': type } })
})
