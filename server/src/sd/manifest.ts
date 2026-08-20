import type { SdBackend } from './backend'

/**
 * Every byte the image-generation feature fetches, pinned.
 *
 * Hashes and sizes are recorded here rather than looked up at download time so
 * that verifying an already-downloaded file works offline, and so an upstream
 * rebuild can never silently change what a given version of freedungeon runs.
 * Same reasoning as the pinned hash on `rmbgModel` in dependencies.ts.
 *
 * stable-diffusion.cpp publishes rolling master builds rather than semver
 * releases, so the tag below is a specific commit. Its archive names embed both
 * that tag and the CI runner's OS version (`macOS-26.5.2`, `Ubuntu-24.04`),
 * which is precisely why whole filenames are pinned instead of templated —
 * they are not predictable across releases.
 *
 * Refreshing to a newer upstream build:
 *   gh api repos/leejet/stable-diffusion.cpp/releases/latest \
 *     --jq '.assets[] | "\(.name)\t\(.size)\t\(.digest)"'
 */
export const SD_RELEASE = 'master-820-de298c2'

/**
 * Asset filenames use `master-<shorthash>` while the tag is
 * `master-<count>-<shorthash>`, so the two genuinely differ and the prefix
 * cannot be derived from the tag.
 */
const SD_ASSET = 'sd-master-de298c2'

const SD_DL = `https://github.com/leejet/stable-diffusion.cpp/releases/download/${SD_RELEASE}`

export type SdArtifact = {
    url: string
    sha256: string
    bytes: number
}

/**
 * A build target is (platform, accelerator) — the accelerator alone is not
 * enough, since the Vulkan archive differs per OS.
 */
export type SdTarget = 'win32-cuda12' | 'win32-vulkan' | 'linux-vulkan' | 'darwin-metal'

export function sdTarget(platform: NodeJS.Platform, backend: SdBackend): SdTarget | null {
    if (platform === 'win32' && backend === 'cuda12') return 'win32-cuda12'
    if (platform === 'win32' && backend === 'vulkan') return 'win32-vulkan'
    if (platform === 'linux' && backend === 'vulkan') return 'linux-vulkan'
    if (platform === 'darwin' && backend === 'metal') return 'darwin-metal'
    return null
}

/**
 * Archives to unpack for each target, in order.
 *
 * CUDA is two: upstream ships the runtime DLLs (`cudart64_*`, `cublas64_*`,
 * `cublasLt64_*`) as a separate archive, built from the same CUDA 12.8.1
 * toolkit as the executable. Both are required, which is why the CUDA path
 * costs ~860 MB against Vulkan's ~39 MB.
 */
export const SD_BINARIES: Record<SdTarget, SdArtifact[]> = {
    'win32-cuda12': [
        {
            url: `${SD_DL}/${SD_ASSET}-bin-win-cuda12-x64.zip`,
            sha256: 'b76a8e8515f8c558a8cac38fadbfd9c2ea49b720c79277e392222beae2f7ea68',
            bytes: 336197151,
        },
        {
            url: `${SD_DL}/cudart-sd-bin-win-cu12-x64.zip`,
            sha256: 'fe20366827d357c00797eebb58244dddab7fd9a348d70090c3871004c320f38d',
            bytes: 563452046,
        },
    ],
    'win32-vulkan': [{
        url: `${SD_DL}/${SD_ASSET}-bin-win-vulkan-x64.zip`,
        sha256: 'e9d3072e090eaa0dc91970034ebccee6fafd502c3226480b46bd12ac54f96889',
        bytes: 38781335,
    }],
    'linux-vulkan': [{
        url: `${SD_DL}/${SD_ASSET}-bin-Linux-Ubuntu-24.04-x86_64-vulkan.zip`,
        sha256: '945b697995d8c7dbde6323d04177d7c12d29091ca84796b423f9ab6c660090ad',
        bytes: 46000063,
    }],
    'darwin-metal': [{
        url: `${SD_DL}/${SD_ASSET}-bin-Darwin-macOS-26.5.2-arm64.zip`,
        sha256: '22ddba91714447fa885ef97cb4040dcb043ffc57531a441cb87737f69d72b7f5',
        bytes: 49908841,
    }],
}

/**
 * The three components sd-server is started with: the diffusion transformer,
 * the VAE decoder, and the text encoder. They are separate files rather than
 * one checkpoint because that is how this pipeline is distributed upstream —
 * see the project's docs/anima.md, which names these exact repositories.
 *
 * Anima is Q8_0 quantised: ~2.2 GB against ~4.4 GB at bf16, for a ~4% speed
 * cost per the publisher's own benchmark, and no visible quality loss at this
 * quant level.
 *
 * Licensing: Anima and its VAE are CircleStone Labs Non-Commercial v1.2 —
 * hobby and personal use, which is what freedungeon is. Its §3(b) attribution
 * notice should be shown where these are downloaded. Qwen3-0.6B-Base is
 * Apache-2.0.
 */
export const SD_MODELS = {
    diffusion: {
        file: 'anima-preview3-base-Q8_0.gguf',
        url: 'https://huggingface.co/Bedovyy/Anima-GGUF/resolve/main/anima-preview3-base-Q8_0.gguf',
        sha256: '8ceef6a28e3fcf1bce5eff1d61858b69afcb709cc90f43c4d6d20bdf470d7546',
        bytes: 2276712576,
    },
    vae: {
        file: 'qwen_image_vae.safetensors',
        url: 'https://huggingface.co/circlestone-labs/Anima/resolve/main/split_files/vae/qwen_image_vae.safetensors',
        sha256: 'a70580f0213e67967ee9c95f05bb400e8fb08307e017a924bf3441223e023d1f',
        bytes: 253806246,
    },
    textEncoder: {
        file: 'Qwen3-0.6B-Base.Q8_0.gguf',
        url: 'https://huggingface.co/mradermacher/Qwen3-0.6B-Base-GGUF/resolve/main/Qwen3-0.6B-Base.Q8_0.gguf',
        sha256: '4b088f1793f6cba9f0c2f77ab835ef6734f205c2159168698c6e1a51b7df168a',
        bytes: 639447232,
    },
} as const satisfies Record<string, SdArtifact & { file: string }>

/** Total bytes fetched on first activation, for the patcher's "this will cost" line. */
export function sdDownloadBytes(target: SdTarget): number {
    const bin = SD_BINARIES[target].reduce((n, a) => n + a.bytes, 0)
    const models = Object.values(SD_MODELS).reduce((n, a) => n + a.bytes, 0)
    return bin + models
}
