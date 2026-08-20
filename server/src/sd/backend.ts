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
 * `nvidia-smi` is the probe rather than an adapter enumeration because it
 * exists if and only if the NVIDIA driver is installed, and it reports the
 * card's architecture directly. Enumerating display adapters would also have to
 * cope with machines that list several — an integrated AMD, a virtual display
 * from remote-desktop software — where "the first one" is routinely wrong.
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
        // Not installed, not on PATH, or no NVIDIA GPU. All mean the same thing
        // here, and none of them are errors worth surfacing.
        return null
    }
}

export async function resolveSdBuild(): Promise<SdBuildChoice> {
    const platform = process.platform
    const arch = process.arch

    if (platform === 'darwin') {
        // Only an arm64 archive is published; Metal is the accelerator there.
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
        // The one gap in "CUDA whenever NVIDIA is present": the project's Linux
        // jobs publish CPU, Vulkan and ROCm archives, and no CUDA one. Falling
        // back to Vulkan silently would work but would quietly cost an NVIDIA
        // owner a large amount of speed with nothing said, so it is refused
        // loudly instead until there is a real answer (a Docker image and a
        // self-build both exist upstream).
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
        // Covers Pascal through Blackwell: upstream builds with CUDA 12.8.1 for
        // architectures 61;70;75;80;86;89;90;100;120, so an sm_120 card runs
        // native SASS rather than JIT-ing from PTX.
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
 * Only NVIDIA is answerable cheaply. Windows' `Win32_VideoController.AdapterRAM`
 * is a 32-bit field and saturates at 4 GiB — it reports a 32 GiB RTX 5090 as
 * 4 — so it is not a usable source for anyone. Unknown is therefore a normal
 * outcome, not a failure, and the flag tiers below treat it as such.
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
 * Runtime flags sized to the machine, rather than to the machine it was
 * developed on.
 *
 * Upstream's own ordering, fastest to smallest-VRAM, is
 *   none -> --offload-to-cpu -> + --max-vram N -> + --stream-layers
 * each step trading a few percent of throughput for room. The tiers below walk
 * that ladder against measured VRAM.
 *
 * `--max-vram -1` is upstream's auto-detect: it reads free VRAM, keeps ~1 GiB
 * headroom, and cuts each forward pass into segments that fit. It is why this
 * doesn't compute a budget itself, and why an unmeasurable GPU is survivable —
 * the problem is handed to the thing that can measure it at runtime.
 *
 * Flash attention is conditional rather than always on: upstream notes it
 * speeds CUDA up but *slows most other backends down*, while saving memory on
 * all of them. So it is free on CUDA, and only worth paying for elsewhere once
 * memory is the binding constraint.
 */
export function sdRuntimeFlags(backend: SdBackend, vramGiB: number | null): string[] {
    // Apple Silicon shares one pool between CPU and GPU, so "offload to CPU"
    // moves nothing and the machine's whole RAM is already available. Hand it
    // straight to the runtime auto-detect.
    if (backend === 'metal') return ['--max-vram', '-1']

    const cuda = backend === 'cuda12'
    const flags: string[] = []
    if (cuda) flags.push('--diffusion-fa')

    // VRAM is only cheaply measurable on NVIDIA, so unknown is the normal case
    // for AMD and Intel — not a signal that the card is small. Treating it as
    // small would put every such GPU on the slowest tier. Instead take the two
    // cheap adaptive flags and let `--max-vram -1` size itself at runtime.
    if (vramGiB === null) return [...flags, '--offload-to-cpu', '--max-vram', '-1']

    if (vramGiB >= 8) return flags                  // everything stays resident

    if (!cuda) flags.push('--diffusion-fa')         // now worth the slowdown
    flags.push('--offload-to-cpu')                  // weights in RAM, staged on use
    if (vramGiB >= 6) return flags

    flags.push('--max-vram', '-1')                  // segment passes to fit free VRAM
    if (vramGiB >= 4) return flags

    flags.push('--stream-layers')                   // stream transformer blocks
    return flags
}
