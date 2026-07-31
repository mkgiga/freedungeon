/**
 * Agent-facing image generation — bridges the `imageGen` feature config to
 * img-gen.ts. Two consumers, both gated on their own sub-toggle:
 *
 *   - item icons, generated once per item definition at define_item exec time
 *   - inline scene images, generated per generate_image call
 *
 * Both bake the resulting /uploads URL into the persisted block, so nothing is
 * cached separately: replaying history rebuilds the URLs along with everything
 * else (see shared/game-state/scope.ts).
 */

import { state } from './server'
import { resolveFeatureConfig, featureEnabled, type ImageGenConfig } from '@shared/features'
import { parseMacros, withItemDescription, withImagePrompt } from './macro'
import { generateImage, setForgeUrl } from './img-gen'
import { storeUpload } from './v2/uploads'
import { withActivity } from './activity'
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

/**
 * The aspect names the agent picks from, and the dimensions they stand for.
 * Kept here rather than in the shared command spec so the agent only ever
 * reasons about shape, never pixels.
 */
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

    setForgeUrl(cfg.endpoint)

    // Template is user-editable at server/src/prompts/GENERATE_IMAGE_VISUAL.macro
    // and reads the agent's description via the `agent_image_prompt` scope.
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
                ...(cfg.checkpoint ? { checkpoint: cfg.checkpoint } : {}),
            })

            const image = result.images[0]
            if (!image) {
                log.server.error('Scene image generation returned no images')
                return undefined
            }

            // No background removal here — a scene image is meant to have one.
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
export async function generateItemIcon(label: string, description: string): Promise<string | undefined> {
    const cfg = imageGenConfig()
    if (!cfg) return undefined

    setForgeUrl(cfg.endpoint)

    // The prompt template is user-editable at
    // server/src/prompts/GENERATE_ITEM_ICON_PROMPT.macro and reads the item
    // description via the `mcp_item_description` scope.
    const prompt = withItemDescription(description, () =>
        parseMacros('{{ @GENERATE_ITEM_ICON_PROMPT() }}').parsed.trim(),
    )

    // The activity is what the UI renders while the turn is blocked here.
    // withActivity clears it in a `finally`, so the failure paths below can't
    // strand a spinner on screen.
    // No `steps` in the activity data: the step count now lives in Forge's own
    // config, so it can only come back from /sdapi/v1/progress at runtime.
    return withActivity('generatingItemIcon', { label }, async (update) => {
        try {
            // Only size and (optionally) checkpoint are specified — steps, CFG
            // and the negative prompt are deliberately left to whatever the
            // user has configured in the Forge UI.
            const result = await generateImage({
                prompt,
                width: cfg.iconSize,
                height: cfg.iconSize,
                ...(cfg.checkpoint ? { checkpoint: cfg.checkpoint } : {}),
            })

            const image = result.images[0]
            if (!image) {
                log.server.error('Item icon generation returned no images')
                return undefined
            }

            // Matte before uploading, so the cached icon and the URL baked into
            // the defineItem block are already background-free — replay never
            // has to redo this. A failed matte degrades to the original image
            // rather than failing the item definition.
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
