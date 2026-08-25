import { Hono } from 'hono'
import { installFromZipBytes } from '../../extensions/host'
import { log } from '../../logger'

/**
 * Extension install by upload.
 *
 * Its own route rather than a tRPC procedure because the payload is an archive:
 * tRPC speaks JSON, and base64-ing a zip through it would inflate it by a third
 * for no gain. Mirrors how image uploads already work.
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
