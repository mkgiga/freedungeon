
let prompts: Map<string, Buffer> | null = null
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
