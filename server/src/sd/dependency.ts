import path from 'node:path'
import { NATIVE_DIR } from '../paths'
import { resolveSdBuild, type SdBuildChoice } from './backend'
import { SD_BINARIES, sdTarget } from './manifest'

/**
 * Everything stable-diffusion.cpp needs lives in one directory: Windows
 * resolves the CUDA DLLs relative to the executable, so the runtime cannot be
 * unpacked anywhere else.
 */
export const SD_DIR = path.join(NATIVE_DIR, 'sd')

/**
 * Resolved once at startup rather than per call: it shells out to nvidia-smi,
 * and the answer cannot change while the process runs.
 */
let choice: SdBuildChoice | null = null

export async function initSdBuildChoice(): Promise<void> {
    choice = await resolveSdBuild()
}

export function getSdBuildChoice(): SdBuildChoice | null {
    return choice
}

/**
 * The archive a given sd dependency pulls, resolved for this machine, in the
 * shape the dependency layer expects.
 *
 * Index 0 is always the sd.cpp build; index 1 exists only on the CUDA target,
 * where the runtime DLLs ship separately. Throwing on an unsupported host —
 * Linux with an NVIDIA card, an Intel Mac — is what surfaces as a 'failed'
 * dependency carrying the reason, instead of a silent nothing.
 */
export function sdArchive(index: number) {
    if (!choice) throw new Error('Image generation support has not been resolved yet.')
    if (!choice.supported) throw new Error(choice.message)

    const target = sdTarget(process.platform, choice.backend)
    if (!target) throw new Error(`No stable-diffusion.cpp build for ${process.platform}/${choice.backend}`)

    const artifact = SD_BINARIES[target][index]
    if (!artifact) throw new Error(`No archive ${index} for ${target}`)
    return { url: artifact.url, expected: { sha256: artifact.sha256, bytes: artifact.bytes } }
}
