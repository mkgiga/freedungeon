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

/**
 * Mirrors an already-uploaded image left-to-right and stores the result,
 * returning the new URL (or null if the argument was not a flippable upload).
 *
 * The flip is baked into the pixels rather than recorded as a flag somewhere,
 * so the mirrored image is just another upload and needs no special handling
 * from anything that renders it.
 *
 * Output is always PNG, whatever went in. Re-encoding a JPEG on every flip
 * would degrade it a little each time; PNG is lossless, so quality is spent
 * once, on the first flip, and never again.
 *
 * That first flip is also the only one that adds a file. Its output is encoded
 * by sharp, and flipping sharp's own output reproduces sharp's encoding of the
 * original pixels exactly — so from then on the two orientations are a stable
 * pair of hashes and flipping back and forth costs nothing. Note this means
 * flipping twice does not return the URL you started from unless that file was
 * already sharp-encoded: the pixels match, the bytes are a re-encode.
 *
 * Deliberately does not delete the original: callers rewrite references to it,
 * and nothing in this app ever removes an upload.
 */
export async function flipUpload(url: string): Promise<string | null> {
    // Only ever reads a plain filename out of the uploads directory. The name
    // is caller-supplied, so anything carrying a path separator or traversal
    // is refused outright instead of being joined onto UPLOADS_DIR.
    const name = url.startsWith('/uploads/') ? url.slice('/uploads/'.length) : null
    if (!name || !/^[A-Za-z0-9._-]+$/.test(name)) return null

    const filePath = path.join(UPLOADS_DIR, name)
    if (!fs.existsSync(filePath)) return null

    const input = await Bun.file(filePath).arrayBuffer()
    if (!await isImage(input)) return null

    // .flop() is the horizontal mirror; sharp's .flip() is the vertical one.
    const flipped = await sharp(Buffer.from(input)).flop().png().toBuffer()

    const { url: newUrl } = await storeUpload(
        flipped.buffer.slice(flipped.byteOffset, flipped.byteOffset + flipped.byteLength) as ArrayBuffer,
        'png',
    )
    return newUrl
}

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
