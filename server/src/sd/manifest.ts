import type { SdBackend } from './backend'

/**
 * Every byte the image-generation feature fetches, pinned by sha256 and size.
 * Recorded here so verification works offline and an upstream rebuild can't
 * change what a given version runs.
 *
 * stable-diffusion.cpp ships rolling master builds, so the tag is a commit, and
 * archive names embed both it and the CI runner's OS version - hence whole
 * filenames rather than templates.
 *
 * To refresh:
 *   gh api repos/leejet/stable-diffusion.cpp/releases/latest \
 *     --jq '.assets[] | "\(.name)\t\(.size)\t\(.digest)"'
 */
export const SD_RELEASE = 'master-820-de298c2'

const SD_ASSET = 'sd-master-de298c2'

const SD_DL = `https://github.com/leejet/stable-diffusion.cpp/releases/download/${SD_RELEASE}`

export type SdArtifact = {
    url: string
    sha256: string
    bytes: number
}

/** Accelerator alone isn't enough - the Vulkan archive differs per OS. */
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
 * CUDA is two: the runtime DLLs (`cudart64_*`, `cublas64_*`, `cublasLt64_*`)
 * ship separately from the executable, both built against CUDA 12.8.1. Both are
 * required - ~860 MB against Vulkan's ~39 MB.
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

const HF_REV = {
    kroma: '4d022118e37efa85e14239818cfde7ddfcf44c69',   // Abiray/Kroma-v0.3.1-Turbo-OPD-GGUF
    krea2: '588feaf955b08b9ac4723eeb751752ab045dba71',   // Comfy-Org/Krea-2
    qwen3vl: '1cd86afb9a95c410a6038ab3b40d8b578c892266', // Qwen/Qwen3-VL-4B-Instruct-GGUF
} as const

export const SD_MODELS = {
    diffusion: {
        file: 'kroma-v0.3.1-turbo-opd-Q6_K.gguf',
        url: `https://huggingface.co/Abiray/Kroma-v0.3.1-Turbo-OPD-GGUF/resolve/${HF_REV.kroma}/kroma-v0.3.1-turbo-opd-Q6_K.gguf`,
        sha256: '0156c88e8955c82a67fbcdc22d02a8079027e2b676033474ad9fc39fa4c17d26',
        bytes: 11944104992,
    },
    vae: {
        file: 'qwen_image_vae.safetensors',
        url: `https://huggingface.co/Comfy-Org/Krea-2/resolve/${HF_REV.krea2}/vae/qwen_image_vae.safetensors`,
        sha256: 'a70580f0213e67967ee9c95f05bb400e8fb08307e017a924bf3441223e023d1f',
        bytes: 253806246,
    },
    textEncoder: {
        file: 'Qwen3VL-4B-Instruct-Q8_0.gguf',
        url: `https://huggingface.co/Qwen/Qwen3-VL-4B-Instruct-GGUF/resolve/${HF_REV.qwen3vl}/Qwen3VL-4B-Instruct-Q8_0.gguf`,
        sha256: '054721f478bc5fa6beffb7f38eae575d45298f88cbb8d2f83ef675a727863eb1',
        bytes: 4280406144,
    },
} as const satisfies Record<string, SdArtifact & { file: string }>

export function sdDownloadBytes(target: SdTarget): number {
    const bin = SD_BINARIES[target].reduce((n, a) => n + a.bytes, 0)
    const models = Object.values(SD_MODELS).reduce((n, a) => n + a.bytes, 0)
    return bin + models
}
