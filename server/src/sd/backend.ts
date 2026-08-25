import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const run = promisify(execFile)

/**
 * Which stable-diffusion.cpp build this machine should run.
 *
 * The project ships one prebuilt archive per (OS, accelerator) pair, so the
 * choice is made here once and everything downstream — which asset to fetch,
 * how big the download is, what to tell the user — follows from it.
 */
export type SdBackend = 'cuda12' | 'vulkan' | 'metal'

export type SdBuildChoice =
    | { supported: true; backend: SdBackend; why: string }
    | { supported: false; code: SdUnsupportedCode; title: string; message: string }

export type SdUnsupportedCode = 'linuxNvidia' | 'platform'

/**
 * NVIDIA compute capability (e.g. "12.0" for Blackwell), or null.
 *
 * `nvidia-smi` is the probe because it exists iff the driver does and reports
 * the architecture directly. Enumerating display adapters would have to pick
 * among several - integrated AMD, virtual remote-desktop displays - where "the
 * first one" is routinely wrong.
 */
export async function nvidiaComputeCap(): Promise<string | null> {
    try {
        const { stdout } = await run(
            'nvidia-smi',
            ['--query-gpu=compute_cap', '--format=csv,noheader'],
            { timeout: 5000, windowsHide: true },
        )
        const cap = stdout.split('\n')[0]?.trim()
        return cap && /^\d+\.\d+$/.test(cap) ? cap : null
    } catch {
        return null
    }
}

export async function resolveSdBuild(): Promise<SdBuildChoice> {
    const platform = process.platform
    const arch = process.arch

    if (platform === 'darwin') {
        if (arch !== 'arm64') {
            return {
                supported: false,
                code: 'platform',
                title: 'Image generation unavailable',
                message: 'stable-diffusion.cpp publishes an Apple Silicon build only. '
                    + 'Intel Macs are not supported.',
            }
        }
        return { supported: true, backend: 'metal', why: 'Apple Silicon (Metal)' }
    }

    const cap = await nvidiaComputeCap()

    if (platform === 'linux') {
        if (cap) {
            return {
                supported: false,
                code: 'linuxNvidia',
                title: 'Linux + NVIDIA not supported yet',
                message: 'Image generation on Linux with an NVIDIA GPU is not implemented yet — '
                    + 'upstream publishes no prebuilt CUDA build for Linux, and falling back to '
                    + 'Vulkan would be far slower than your card is capable of. Coming soon.',
            }
        }
        return { supported: true, backend: 'vulkan', why: 'Linux without NVIDIA (Vulkan)' }
    }

    if (platform === 'win32') {
        if (cap) return { supported: true, backend: 'cuda12', why: `NVIDIA compute ${cap} (CUDA 12)` }
        return { supported: true, backend: 'vulkan', why: 'Windows without NVIDIA (Vulkan)' }
    }

    return {
        supported: false,
        code: 'platform',
        title: 'Image generation unavailable',
        message: `No stable-diffusion.cpp build is published for ${platform}/${arch}.`,
    }
}

/**
 * Total VRAM in GiB for an NVIDIA card, or null when it can't be known.
 *
 * Only NVIDIA is cheap to answer. Windows' `Win32_VideoController.AdapterRAM`
 * is 32-bit and saturates at 4 GiB, so it reports a 32 GiB card as 4. Unknown
 * is a normal outcome rather than a failure; the flag tiers treat it as such.
 */
export async function nvidiaVramGiB(): Promise<number | null> {
    try {
        const { stdout } = await run(
            'nvidia-smi',
            ['--query-gpu=memory.total', '--format=csv,noheader,nounits'],
            { timeout: 5000, windowsHide: true },
        )
        const mib = Number(stdout.split('\n')[0]?.trim())
        return Number.isFinite(mib) && mib > 0 ? mib / 1024 : null
    } catch {
        return null
    }
}

/**
 * Runtime flags picked from measured VRAM, walking upstream's ladder:
 *   none -> --offload-to-cpu -> + --max-vram N -> + --stream-layers
 *
 * `--max-vram -1` is upstream's auto-detect: it reads free VRAM at runtime and
 * segments each pass to fit, so no budget is computed here and an unmeasurable
 * GPU still works. Flash attention speeds up CUDA but slows other backends, so
 * it is on for CUDA and used elsewhere only when memory is the constraint.
 */
export function sdRuntimeFlags(backend: SdBackend, vramGiB: number | null): string[] {
    if (backend === 'metal') return ['--max-vram', '-1']

    const cuda = backend === 'cuda12'
    const flags: string[] = []
    if (cuda) flags.push('--diffusion-fa')

    if (vramGiB === null) return [...flags, '--offload-to-cpu', '--max-vram', '-1']

    if (vramGiB >= 8) return flags

    if (!cuda) flags.push('--diffusion-fa')
    flags.push('--offload-to-cpu')
    if (vramGiB >= 6) return flags

    flags.push('--max-vram', '-1')
    if (vramGiB >= 4) return flags

    flags.push('--stream-layers')
    return flags
}
