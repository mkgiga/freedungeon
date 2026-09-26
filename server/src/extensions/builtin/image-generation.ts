import pkg from '../../../package.json' with { type: 'json' }
import type { ExtensionManifest } from '@shared/extensions'
import type { SchemaField } from '@shared/schema-ui'
import { DEPENDENCIES } from '@shared/dependencies'
import { ensureDependency, isSatisfied } from '../../dependencies'
import { requiredSdDependencies } from '../../sd/server'
import { getSdBuildChoice } from '../../sd/dependency'
import { cancelAgentTurn } from '../../agent'
import { notification } from '../../notifications'
import type { ExtensionModule } from '../sdk'

/** Style injected for `{{ user_style_preference }}` when the user left it blank. */
export const DEFAULT_STYLE_PREFERENCE = 'anime screencap'

export const IMAGE_GENERATION_INSTRUCTIONS = `# 【Generated Images】

You can render an image into the story with \`generate_image\`. Pass a \`description\` written for an image model — subject and action, setting, framing and camera angle, lighting, mood, colour, in concrete visual nouns; it knows nothing of the story, so name what is in frame rather than who it is to the plot. Pass an \`aspect\` of "landscape" (establishing shots, vistas), "portrait" (a figure, a tall space) or "square", and optionally \`caption\` text to sit beneath the image.

The image is generated on the spot and the turn blocks until it is done, so spend it where a visual does work prose would not: arriving somewhere the party has never seen, a reveal whose look carries the beat. At most one per beat, and never as decoration for a moment you have already described well.`

export type ImageGenConfig = {
    generateItemIcons: boolean
    removeIconBackground: boolean
    generateImages: boolean
    stylePreference: string
    iconSize: number
}

const FIELDS: SchemaField[] = [
    {
        path: ['generateItemIcons'],
        label: 'Generate item icons',
        description: 'An icon for every item the dungeon master creates. Slower turns.',
        default: false,
        control: { type: 'toggle' },
    },
    {
        path: ['removeIconBackground'],
        label: 'Remove item icon backgrounds',
        description: 'Runs locally. Downloads ~88MB the first time.',
        default: true,
        control: { type: 'toggle' },
    },
    {
        path: ['generateImages'],
        label: 'Generate scene images',
        description: 'Lets the dungeon master illustrate places and moments. Slower turns.',
        default: false,
        control: { type: 'toggle' },
    },
    {
        path: ['stylePreference'],
        label: 'Style',
        description: 'Art style for icons and scene images. Blank means "anime screencap".',
        default: '',
        control: { type: 'text' },
    },
    {
        path: ['iconSize'],
        label: 'Icon size (px)',
        default: 512,
        control: { type: 'slider', min: 128, max: 1024, step: 64 },
    },
]

export const manifest: ExtensionManifest = {
    id: 'core.imageGeneration',
    name: 'Image generation',
    version: pkg.version,
    description: 'Draws pictures on this machine. Downloads about 3 GB the first time.',
    author: 'freedungeon',
    main: '',
}

/**
 * A turn already in flight would fail partway through, since the files it
 * needs are still arriving. Stopping it is kinder than letting it die mid
 * sentence, and the user is told why.
 */
async function stopTurnForDownload(): Promise<void> {
    await cancelAgentTurn()
    notification({
        title: 'Turn stopped',
        content: 'Image generation was switched on, and its files are still downloading. '
            + 'The current turn was stopped so it could not fail partway through.',
        backgroundColor: '#7a5a1f',
        textColor: '#fff',
        show: true,
        toast: true,
        push: false,
    })
}

async function ensureAll(keys: Parameters<typeof ensureDependency>[0][]): Promise<void> {
    for (const key of keys) {
        await ensureDependency(key)
        if (!(await isSatisfied(key))) {
            throw new Error(`${DEPENDENCIES[key].label} could not be downloaded, so image generation can't run.`)
        }
    }
}

export const module: ExtensionModule = {
    async activate(fd) {
        fd.settings.define(FIELDS)

        fd.prompt.scope('user_style_preference', () => {
            const style = String(fd.settings.get('stylePreference', '')).trim()
            return style || DEFAULT_STYLE_PREFERENCE
        })

        fd.prompt.section(() =>
            fd.settings.get('generateImages', false) ? IMAGE_GENERATION_INSTRUCTIONS : null)

        // Background removal downloads its own model, so it is gated where it
        // is switched on rather than at activation.
        fd.settings.onChange(async (next, prev) => {
            if (next.removeIconBackground !== true || prev.removeIconBackground === true) return
            await ensureDependency('rmbgModel')
            if (!(await isSatisfied('rmbgModel'))) {
                throw new Error(
                    `${DEPENDENCIES.rmbgModel.label} could not be downloaded, so background removal can't be enabled.`,
                )
            }
        })

        const choice = getSdBuildChoice()
        if (choice && !choice.supported) throw new Error(choice.message)

        const required = requiredSdDependencies()
        const missing: typeof required = []
        for (const key of required) if (!(await isSatisfied(key))) missing.push(key)

        if (missing.length > 0) {
            await stopTurnForDownload()
            await ensureAll(required)
        }

        if (fd.settings.get('removeIconBackground', true)) {
            await ensureDependency('rmbgModel')
        }
    },
}
