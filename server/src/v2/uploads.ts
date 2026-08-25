import { Hono } from 'hono'
import path from 'node:path'
import fs from 'node:fs'
import sharp from 'sharp'
import { fileTypeFromBuffer } from 'file-type'
import { UPLOADS_DIR, THUMBS_DIR } from '../paths'

const THUMB_MAX_DIM = 128

function ensureDirs() {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true })
    fs.mkdirSync(THUMBS_DIR, { recursive: true })
}

async function isImage(buffer: ArrayBuffer): Promise<boolean> {
    const type = await fileTypeFromBuffer(buffer)
    return type?.mime.startsWith('image/') ?? false
}

async function generateThumbnail(buffer: ArrayBuffer, filename: string): Promise<void> {
    const thumbPath = path.join(THUMBS_DIR, filename)
    if (fs.existsSync(thumbPath)) return

    await sharp(Buffer.from(buffer))
        .resize({
            width: THUMB_MAX_DIM,
            height: THUMB_MAX_DIM,
            fit: 'inside',
            withoutEnlargement: true,
        })
        .toFile(thumbPath)
}

export const uploadsRouter = new Hono()

uploadsRouter.get('/thumbs/:filename', async (c) => {
    const filename = c.req.param('filename')
    const thumbPath = path.join(THUMBS_DIR, filename)

    if (!fs.existsSync(thumbPath)) {
        const originalPath = path.join(UPLOADS_DIR, filename)
        if (!fs.existsSync(originalPath)) {
            return c.text('Not found', 404)
        }
        const buffer = await Bun.file(originalPath).arrayBuffer()
        if (await isImage(buffer)) {
            await generateThumbnail(buffer, filename)
        } else {
            return c.text('Not an image', 400)
        }
    }

    const file = Bun.file(thumbPath)
    return new Response(file)
})

uploadsRouter.get('/:filename', async (c) => {
    const filename = c.req.param('filename')
    const filePath = path.join(UPLOADS_DIR, filename)

    if (!fs.existsSync(filePath)) {
        return c.text('Not found', 404)
    }

    const file = Bun.file(filePath)
    return new Response(file)
})

uploadsRouter.post('/', async (c) => {
    ensureDirs()

    const formData = await c.req.formData()
    const file = formData.get('file') as File | null
    if (!file) {
        return c.json({ error: 'No file provided' }, 400)
    }

    const { url, thumbnailUrl } = await storeUpload(await file.arrayBuffer(), file.name.split('.').pop() ?? 'png')
    return c.json({ url, thumbnailUrl })
})

/**
 * Shared by the HTTP upload route and by server-side producers, so dedup and
 * thumbnailing behave identically for both.
 */
export async function storeUpload(
    buffer: ArrayBuffer,
    ext = 'png',
): Promise<{ url: string; thumbnailUrl?: string }> {
    ensureDirs()

    const hash = new Bun.CryptoHasher('sha256').update(buffer).digest('hex')
    const filename = `${hash}.${ext}`
    const filePath = path.join(UPLOADS_DIR, filename)

    if (!fs.existsSync(filePath)) {
        await Bun.write(filePath, buffer)
    }

    let thumbnailUrl: string | undefined
    if (await isImage(buffer)) {
        await generateThumbnail(buffer, filename)
        thumbnailUrl = `/uploads/thumbs/${filename}`
    }

    return { url: `/uploads/${filename}`, thumbnailUrl }
}
