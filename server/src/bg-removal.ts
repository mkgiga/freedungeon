
import sharp from 'sharp'
import type * as ortTypes from 'onnxruntime-node'
import { dependencyPath } from './dependencies'

const MEAN = 0.5
const STD = 1.0
const SIZE = 1024

const EXECUTION_PROVIDERS: string[] = ['cpu']

let sessionPromise: Promise<ortTypes.InferenceSession> | null = null

let ortPromise: Promise<typeof ortTypes> | null = null
function loadOrt(): Promise<typeof ortTypes> {
    if (!ortPromise) ortPromise = import('onnxruntime-node')
    return ortPromise
}

async function requireModel(): Promise<string> {
    const file = await dependencyPath('rmbgModel')
    if (!file) {
        throw new Error(
            'RMBG-1.4 weights are missing or failed verification. Re-enable background removal in preferences to download them again.',
        )
    }
    return file
}

function getSession(): Promise<ortTypes.InferenceSession> {
    if (!sessionPromise) {
        sessionPromise = (async () => {
            const MODEL_PATH = await requireModel()
            const ort = await loadOrt()
            return ort.InferenceSession.create(MODEL_PATH, {
                executionProviders: EXECUTION_PROVIDERS as any,
            })
        })().catch((err) => {
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

    const ort = await loadOrt()
    const outputs = await session.run({
        [session.inputNames[0]!]: new ort.Tensor('float32', input, [1, 3, SIZE, SIZE]),
    })
    const matte = outputs[session.outputNames[0]!]!.data as Float32Array

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
