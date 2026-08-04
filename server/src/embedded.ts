/**
 * Assets that live inside the compiled binary.
 *
 * A standalone build can't read the source tree: `import.meta.dirname` points
 * into the virtual filesystem, `readdirSync` on it fails, and the client bundle
 * isn't on disk at all. So build.ts packs every prompt and client file into a
 * single blob (see asset-blob.ts) which entry.ts unpacks and registers here
 * before the server starts.
 *
 * Running from source registers nothing, and every consumer falls back to
 * reading the real directories — so dev keeps its live-reload behaviour and
 * nothing generated needs to be committed.
 */

/** Contents of each `.macro` file, keyed by filename. */
let prompts: Map<string, Buffer> | null = null
/** Contents of each built client file, keyed by its dist-relative path. */
let clientFiles: Map<string, ArrayBuffer> | null = null

export function setEmbeddedAssets(assets: {
    prompts: Map<string, Buffer>
    clientFiles: Map<string, ArrayBuffer>
}): void {
    prompts = assets.prompts
    clientFiles = assets.clientFiles
}

/** True when running as a compiled binary rather than from source. */
export function isEmbedded(): boolean {
    return clientFiles !== null
}

export function getEmbeddedPrompts(): Map<string, Buffer> | null {
    return prompts
}

export function getEmbeddedClientFiles(): Map<string, ArrayBuffer> | null {
    return clientFiles
}
