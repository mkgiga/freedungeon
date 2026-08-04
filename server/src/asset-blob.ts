/**
 * The container the compiled binary carries its assets in.
 *
 * Everything the server needs but can't read from disk — the built client, the
 * .macro prompts, the native modules — is packed into one file at build time
 * and imported with `{ type: 'file' }`. One import, no generated source.
 *
 * Layout:
 *
 *   [4 bytes  ] little-endian length of the index
 *   [N bytes  ] JSON index: { "path/in/blob": [offset, length] }
 *   [remainder] zstd-compressed payloads, concatenated; offsets are into the
 *               DECOMPRESSED payload section
 *
 * The index sits outside the compressed section so the format stays
 * inspectable, and because it costs nothing to leave it there.
 */

const HEADER_BYTES = 4

export type BlobEntry = { key: string; bytes: Uint8Array }

export function packBlob(entries: BlobEntry[]): Uint8Array {
    const index: Record<string, [number, number]> = {}
    const payloads: Uint8Array[] = []
    let offset = 0

    for (const { key, bytes } of entries) {
        index[key] = [offset, bytes.length]
        payloads.push(bytes)
        offset += bytes.length
    }

    const header = Buffer.from(JSON.stringify(index), 'utf8')
    const headerLen = Buffer.alloc(HEADER_BYTES)
    headerLen.writeUInt32LE(header.length)

    return Buffer.concat([
        headerLen,
        header,
        Bun.zstdCompressSync(Buffer.concat(payloads)),
    ])
}

/**
 * Decompress a packed blob into per-key buffers.
 *
 * Each buffer is a copy rather than a view: a subarray would keep the whole
 * decompressed payload section alive, and the natives in it are ~46MB that we
 * only need long enough to write to disk.
 */
export function unpackBlob(blob: Uint8Array): Map<string, Buffer> {
    const buf = Buffer.from(blob.buffer, blob.byteOffset, blob.byteLength)
    const headerLen = buf.readUInt32LE(0)
    const index: Record<string, [number, number]> = JSON.parse(
        buf.subarray(HEADER_BYTES, HEADER_BYTES + headerLen).toString('utf8'),
    )
    const payload = Buffer.from(Bun.zstdDecompressSync(buf.subarray(HEADER_BYTES + headerLen)))

    const out = new Map<string, Buffer>()
    for (const [key, [offset, length]] of Object.entries(index)) {
        out.set(key, Buffer.from(payload.subarray(offset, offset + length)))
    }
    return out
}
