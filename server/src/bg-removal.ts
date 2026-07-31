/**
 * Background removal for generated images, via BRIA RMBG-1.4 run locally
 * through onnxruntime-node.
 *
 * Model choice: RMBG-1.4 rather than 2.0 because 2.0's HF repo is gated
 * (`gated: "auto"` — a form grants access, but downloads then need a token),
 * while 1.4 is a plain 88MB fp16 fetch with no credentials. Both carry BRIA's
 * non-commercial terms, which this project satisfies. Swapping to 2.0 means
 * changing MODEL_URL and MEAN/STD (2.0 uses ImageNet normalization) — the rest
 * of this file is model-agnostic.
 *
 * Weights are fetched on first use into server/data/models/ and cached there,
 * alongside the db and uploads. Nothing is committed to the repo.
 */

import path from 'node:path'
import fs from 'node:fs'
import sharp from 'sharp'
import * as ort from 'onnxruntime-node'
import { log } from './logger'

const MODEL_URL = 'https://huggingface.co/briaai/RMBG-1.4/resolve/main/onnx/model_fp16.onnx'
const MODEL_DIR = path.join(import.meta.dirname, '..', 'data', 'models')
const MODEL_PATH = path.join(MODEL_DIR, 'rmbg-1.4-fp16.onnx')

/** RMBG-1.4's preprocessor_config.json: rescale 1/255, mean 0.5, std 1.0. */
const MEAN = 0.5
const STD = 1.0
/** Both RMBG generations take a fixed 1024x1024 input. */
const SIZE = 1024

/**
 * CPU rather than dml/webgpu: measured within noise of DirectML for a model
 * this size (~1s either way), and the GPU is typically already saturated by
 * the Stable Diffusion job that produced the image we're now matting.
 */
const EXECUTION_PROVIDERS: string[] = ['cpu']

let sessionPromise: Promise<ort.InferenceSession> | null = null

async function ensureModel(): Promise<void> {
    if (fs.existsSync(MODEL_PATH)) return
    fs.mkdirSync(MODEL_DIR, { recursive: true })

    log.server.info(`Downloading RMBG-1.4 weights (~88MB) to ${MODEL_PATH}`)
    const res = await fetch(MODEL_URL)
    if (!res.ok) throw new Error(`RMBG download failed: ${res.status} ${res.statusText}`)

    // Write to a temp path first so an interrupted download can't leave a
    // truncated file that later looks like a valid cached model.
    const tmp = `${MODEL_PATH}.partial`
    await Bun.write(tmp, res)
    fs.renameSync(tmp, MODEL_PATH)
    log.server.ok('RMBG-1.4 weights ready')
}

/** Lazily create (and reuse) the inference session. */
function getSession(): Promise<ort.InferenceSession> {
    if (!sessionPromise) {
        sessionPromise = (async () => {
            await ensureModel()
            return ort.InferenceSession.create(MODEL_PATH, {
                executionProviders: EXECUTION_PROVIDERS as any,
            })
        })().catch((err) => {
            // Don't cache a failed init — a later call should retry rather than
            // inherit a permanently rejected promise.
            sessionPromise = null
            throw err
        })
    }
    return sessionPromise
}

/**
 * Return `png` with its background made transparent. Throws on failure —
 * callers decide whether a failed matte should sink the surrounding operation
 * (for item icons it does not; see item-icons.ts).
 */
export async function removeBackground(png: Uint8Array): Promise<Uint8Array> {
    const session = await getSession()

    const image = sharp(Buffer.from(png))
    const meta = await image.metadata()
    const width = meta.width ?? SIZE
    const height = meta.height ?? SIZE

    // Preprocess: resize to the model's fixed input, drop alpha, convert
    // interleaved RGB to planar NCHW float.
    // `kernel: 'linear'` (bilinear) matches the reference implementation's
    // `F.interpolate(..., mode='bilinear')` and preprocessor_config.json's
    // `"resample": 2` (PIL BILINEAR). sharp defaults to lanczos3, whose ringing
    // shows up as edge halos in the resulting matte. `fit: 'fill'` is likewise
    // deliberate — the reference does not preserve aspect ratio.
    const { data } = await sharp(Buffer.from(png))
        .resize(SIZE, SIZE, { fit: 'fill', kernel: 'linear' })
        .removeAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true })

    const px = SIZE * SIZE
    const input = new Float32Array(3 * px)
    for (let i = 0; i < px; i++) {
        input[i] = (data[i * 3]! / 255 - MEAN) / STD
        input[i + px] = (data[i * 3 + 1]! / 255 - MEAN) / STD
        input[i + px * 2] = (data[i * 3 + 2]! / 255 - MEAN) / STD
    }

    const outputs = await session.run({
        [session.inputNames[0]!]: new ort.Tensor('float32', input, [1, 3, SIZE, SIZE]),
    })
    const matte = outputs[session.outputNames[0]!]!.data as Float32Array

    // Min-max stretch, per the reference `postprocess_image`. It normalizes
    // after resizing to the source dimensions whereas we normalize first;
    // bilinear interpolation can't produce values outside the source range, so
    // the two differ only when the extreme is an isolated outlier that
    // resampling smooths away. The `|| 1` guards a uniform matte.
    let lo = Infinity
    let hi = -Infinity
    for (const v of matte) {
        if (v < lo) lo = v
        if (v > hi) hi = v
    }
    const span = hi - lo || 1

    const alpha = Buffer.allocUnsafe(px)
    for (let i = 0; i < px; i++) {
        alpha[i] = Math.round(Math.max(0, Math.min(1, (matte[i]! - lo) / span)) * 255)
    }

    // Back to the source resolution, then interleave into RGBA by hand.
    // `joinChannel` looks like the natural fit here but yields a 3-channel PNG
    // with no alpha — sharp doesn't treat the joined plane as alpha on this
    // path. Building the RGBA buffer directly is unambiguous.
    // `toColourspace('b-w')` is load-bearing: sharp otherwise promotes a
    // 1-channel raw input to 3-channel sRGB, and indexing that as if it were
    // single-channel misreads the matte at a 3x stride.
    const alphaAtSize = await sharp(alpha, { raw: { width: SIZE, height: SIZE, channels: 1 } })
        .resize(width, height, { fit: 'fill', kernel: 'linear' })
        .toColourspace('b-w')
        .raw()
        .toBuffer()
    if (alphaAtSize.length !== width * height) {
        throw new Error(`matte stride mismatch: got ${alphaAtSize.length}, expected ${width * height}`)
    }

    const rgb = await sharp(Buffer.from(png)).removeAlpha().raw().toBuffer()
    const rgba = Buffer.allocUnsafe(width * height * 4)
    for (let i = 0; i < width * height; i++) {
        rgba[i * 4] = rgb[i * 3]!
        rgba[i * 4 + 1] = rgb[i * 3 + 1]!
        rgba[i * 4 + 2] = rgb[i * 3 + 2]!
        rgba[i * 4 + 3] = alphaAtSize[i]!
    }

    return new Uint8Array(
        await sharp(rgba, { raw: { width, height, channels: 4 } }).png().toBuffer(),
    )
}
