import type { FeatureConfig } from '@shared/features'

/**
 * Calls the user's DramaBox HTTP wrapper to synthesize one clip. Sends the
 * composed prompt + synthesis params, and the optional voice-reference clip as
 * multipart (the wrapper runs on a separate box and can't read our disk).
 * Returns wav bytes.
 */

export type SynthInput = {
    prompt: string
    voiceRef?: { bytes: Uint8Array; ext: string }
}

export async function synthesize(cfg: FeatureConfig, input: SynthInput): Promise<Uint8Array> {
    const endpoint = String(cfg.values.dramaboxEndpoint ?? '').replace(/\/+$/, '')
    if (!endpoint) throw new Error('DramaBox endpoint not configured')

    const form = new FormData()
    form.append('prompt', input.prompt)
    form.append('cfg_scale', String(cfg.values.cfgScale ?? 2.5))
    form.append('stg_scale', String(cfg.values.stgScale ?? 1.5))
    form.append('denoise_ref', String(cfg.values.denoiseRef ?? true))
    if (input.voiceRef) {
        form.append('voice_ref', new Blob([input.voiceRef.bytes]), `ref.${input.voiceRef.ext}`)
    }

    const res = await fetch(`${endpoint}/tts`, { method: 'POST', body: form })
    if (!res.ok) {
        const t = await res.text().catch(() => '')
        throw new Error(`dramabox ${res.status}: ${t.slice(0, 200)}`)
    }
    return new Uint8Array(await res.arrayBuffer())
}
