/**
 * Item icon generation — bridges the `imageGen` feature config to img-gen.ts.
 *
 * Icons are generated once per item definition at define_item exec time, then
 * written into the uploads dir and embedded as a URL in the persisted
 * defineItem block. Nothing is cached separately: replaying history rebuilds
 * `ctx.itemDefs`, so the "cache" is the game state itself (see
 * shared/game-state/scope.ts).
 */

import { state } from './server'
import { resolveFeatureConfig, featureEnabled, type ImageGenConfig } from '@shared/features'
import { parseMacros, withItemDescription } from './macro'
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
