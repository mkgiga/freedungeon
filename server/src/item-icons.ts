
import { state } from './server'
import { resolveFeatureConfig, featureEnabled, type ImageGenConfig } from '@shared/features'
import { parseMacros, withItemDescription, withImagePrompt } from './macro'
import { generateImage, getTaskProgress } from './img-gen'
import { storeUpload } from './v2/uploads'
import { withActivity } from './activity'
import { nanoid } from 'nanoid'
import { removeBackground } from './bg-removal'
import { log } from './logger'

export function imageGenConfig(): ImageGenConfig | null {
    if (!featureEnabled(state.userPreferences, 'imageGen')) return null
    const cfg = resolveFeatureConfig('imageGen', state.userPreferences.features?.['imageGen'])
    return cfg.values as ImageGenConfig
}

export function itemIconsEnabled(): boolean {
    return imageGenConfig()?.generateItemIcons === true
}

export function sceneImagesEnabled(): boolean {
    return imageGenConfig()?.generateImages === true
}

const ASPECT_DIMENSIONS = {
    square: { width: 1024, height: 1024 },
    landscape: { width: 1280, height: 832 },
    portrait: { width: 832, height: 1280 },
} as const

export type ImageAspect = keyof typeof ASPECT_DIMENSIONS

/**
 * Unlike item icons, the caller treats undefined as a failed tool call - an
 * image block with no src is just a broken image.
 */
export async function generateSceneImage(
    description: string,
    aspect: ImageAspect,
): Promise<string | undefined> {
    const cfg = imageGenConfig()
    if (!cfg) return undefined

    const prompt = withImagePrompt(description, () =>
        parseMacros('{{ GENERATE_IMAGE_VISUAL() }}').parsed.trim(),
    )

    const { width, height } = ASPECT_DIMENSIONS[aspect]

    return withActivity('generatingImage', { aspect }, async () => {
        try {
            const result = await generateImage({
                prompt,
                width,
                height,
                scheduler: "ER-SDE",
                steps: 30,
                negativePrompt: "score_1, score_2, score_3, worst quality, low quality, blurry, censored",
            })

            const image = result.images[0]
            if (!image) {
                log.server.error('Scene image generation returned no images')
                return undefined
            }

            const { url } = await storeUpload(
                image.png.buffer.slice(
                    image.png.byteOffset,
                    image.png.byteOffset + image.png.byteLength,
                ) as ArrayBuffer,
                'png',
            )
            return url
        } catch (err) {
            log.server.error(`Scene image generation failed: ${err}`)
            return undefined
        }
    })
}

/**
 * Returns undefined rather than throwing - a slow or absent image backend must
 * not fail the agent's tool call. The item is still defined, and redefining it
 * retries.
 */
export async function generateItemIcon(label: string, description: string, itemKey?: string): Promise<string | undefined> {
    const cfg = imageGenConfig()
    if (!cfg) return undefined

    const taskId = `freedungeon-icon-${nanoid(8)}`

    const prompt = withItemDescription(description, () =>
        parseMacros('{{ GENERATE_ITEM_ICON_PROMPT() }}').parsed.trim(),
    )

    return withActivity('generatingItemIcon', { label, key: itemKey }, async (update) => {
        try {
            const stopPolling = pollTask(taskId, update)
            let result
            try {
                result = await generateImage({
                    prompt,
                    width: cfg.iconSize,
                    height: cfg.iconSize,
                    taskId,
                    })
            } finally {
                stopPolling()
            }

            const image = result.images[0]
            if (!image) {
                log.server.error('Item icon generation returned no images')
                return undefined
            }

            let png = image.png
            if (cfg.removeIconBackground) {
                update({ phase: 'removingBackground' })
                try {
                    png = await removeBackground(png)
                } catch (err) {
                    log.server.warn(`Background removal failed, keeping original: ${err}`)
                }
            }

            const { url } = await storeUpload(
                png.buffer.slice(
                    png.byteOffset,
                    png.byteOffset + png.byteLength,
                ) as ArrayBuffer,
                'png',
            )
            return url
        } catch (err) {
            log.server.error(`Item icon generation failed: ${err}`)
            return undefined
        }
    })
}

function pollTask(taskId: string, update: (patch: Record<string, unknown>) => void): () => void {
    const timer = setInterval(async () => {
        const p = await getTaskProgress(taskId)
        if (!p) return
        update({
            queued: p.queued,
            progress: p.progress ?? undefined,
            etaSeconds: p.etaSeconds ?? undefined,
        })
    }, 600)
    return () => clearInterval(timer)
}

/**
 * Fire-and-forget - an item is usable without an icon, so the turn continues
 * rather than blocking `define_item` on the image model. `onDone` runs only on
 * success.
 */
export function queueItemIcon(label: string, description: string, itemKey: string, onDone: (url: string) => void): void {
    void generateItemIcon(label, description, itemKey)
        .then(url => { if (url) onDone(url) })
        .catch(err => log.server.error(`Item icon job failed: ${err}`))
}
