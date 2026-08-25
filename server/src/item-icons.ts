
import { state } from './server'
import { resolveFeatureConfig, featureEnabled, type ImageGenConfig } from '@shared/features'
import { parseMacros, withItemDescription, withImagePrompt } from './macro'
import { generateImage, getTaskProgress } from './img-gen'
import { storeUpload } from './v2/uploads'
import { withActivity } from './activity'
import { nanoid } from 'nanoid'
import { removeBackground } from './bg-removal'
import { log } from './logger'

/** Resolved imageGen config, or null when the feature is off. */
export function imageGenConfig(): ImageGenConfig | null {
    if (!featureEnabled(state.userPreferences, 'imageGen')) return null
    const cfg = resolveFeatureConfig('imageGen', state.userPreferences.features?.['imageGen'])
    return cfg.values as ImageGenConfig
}

/** Whether the agent should be offered the define_item icon workflow. */
export function itemIconsEnabled(): boolean {
    return imageGenConfig()?.generateItemIcons === true
}

/** Whether the agent should be offered the generate_image tool. */
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
 * Generate an inline scene image and return its /uploads URL, or undefined if
 * generation failed. Unlike item icons, the caller treats undefined as a failed
 * tool call — an image block with no src is nothing but a broken image.
 */
export async function generateSceneImage(
    description: string,
    aspect: ImageAspect,
): Promise<string | undefined> {
    const cfg = imageGenConfig()
    if (!cfg) return undefined

    const prompt = withImagePrompt(description, () =>
        parseMacros('{{ @GENERATE_IMAGE_VISUAL() }}').parsed.trim(),
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
 * Generate an icon for an item and return its /uploads URL.
 *
 * Returns undefined rather than throwing: a Forge server that is down or slow
 * must not fail the agent's tool call — the item is still defined, just
 * without an icon, and the agent can redefine it later to retry.
 */
export async function generateItemIcon(label: string, description: string, itemKey?: string): Promise<string | undefined> {
    const cfg = imageGenConfig()
    if (!cfg) return undefined

    const taskId = `freedungeon-icon-${nanoid(8)}`

    const prompt = withItemDescription(description, () =>
        parseMacros('{{ @GENERATE_ITEM_ICON_PROMPT() }}').parsed.trim(),
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
 * Start an icon generation and hand the URL back when it lands.
 *
 * Fire-and-forget by design: `define_item` used to await the icon inside the
 * tool call, so the model sat idle for the whole generation before its tool
 * result came back. The item is fully usable without an icon, so the turn
 * continues immediately and the picture catches up.
 *
 * `onDone` runs only on success; a failed generation leaves the item as it is,
 * which is the same outcome the awaited version produced.
 */
export function queueItemIcon(label: string, description: string, itemKey: string, onDone: (url: string) => void): void {
    void generateItemIcon(label, description, itemKey)
        .then(url => { if (url) onDone(url) })
        .catch(err => log.server.error(`Item icon job failed: ${err}`))
}
