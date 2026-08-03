/**
 * Assets that live inside the compiled binary.
 *
 * A standalone build can't read the source tree: `import.meta.dirname` points
 * into the virtual filesystem, `readdirSync` on it fails, and the client bundle
 * isn't on disk at all. So `build.ts` generates an entry module that imports
 * every prompt and client file with `{ type: 'file' }` and registers the
 * resulting virtual paths here before the server starts.
 *
 * Running from source registers nothing, and every consumer falls back to
 * reading the real directories — so dev keeps its live-reload behaviour and
 * nothing generated needs to be committed.
 */

/** Virtual path of each `.macro` file, keyed by filename. */
let prompts: Record<string, string> | null = null
/** Virtual path of each built client file, keyed by its dist-relative path. */
let clientFiles: Record<string, string> | null = null

export function setEmbeddedAssets(assets: {
    prompts: Record<string, string>
    clientFiles: Record<string, string>
}): void {
    prompts = assets.prompts
    clientFiles = assets.clientFiles
}

/** True when running as a compiled binary rather than from source. */
export function isEmbedded(): boolean {
    return clientFiles !== null
}

export function getEmbeddedPrompts(): Record<string, string> | null {
    return prompts
}

export function getEmbeddedClientFiles(): Record<string, string> | null {
    return clientFiles
}
