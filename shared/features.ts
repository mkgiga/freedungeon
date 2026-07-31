import type { SchemaField } from './schema-ui'

/**
 * A toggleable, user-configurable feature. Code-defined (like the command
 * registry) so the client renders its params via SchemaForm and the server
 * reads the resolved config from one source of truth.
 *
 * `schema` uses a FLAT value namespace (single-element field paths) so the
 * resolve-on-read merge below is a trivial shallow merge — newly-added params
 * pick up their defaults without a nested deep-merge.
 */
export type FeatureSpec = {
    key: string
    name: string
    description: string
    schema: SchemaField[]
    defaults: Record<string, unknown>
}

/** Per-feature stored config (in userPreferences.features[key]). */
export type FeatureConfig = {
    enabled: boolean
    values: Record<string, unknown>
}

export const FEATURES: Record<string, FeatureSpec> = {
    choicePrompts: {
        key: 'choicePrompts',
        name: 'Multiple-choice prompts',
        description: 'Let the agent optionally end a turn with a menu of suggested actions. You can always type your own instead.',
        schema: [],
        defaults: {},
    },

    imageGen: {
        key: 'imageGen',
        name: 'Image generation',
        description: 'Connect a Stable Diffusion WebUI Forge server so the agent can generate images. Requires Forge running with --api.',
        schema: [
            {
                path: ['endpoint'],
                label: 'Forge API endpoint',
                description: 'Base URL of the SD WebUI Forge server, e.g. http://localhost:7860',
                default: 'http://localhost:7860',
                control: { type: 'text' },
            },
            {
                path: ['generateItemIcons'],
                label: 'Generate item icons',
                description: 'Give the agent a define_item tool that generates an icon for each item it defines. Adds noticeable latency to those tool calls — the turn waits for the image.',
                default: false,
                control: { type: 'toggle' },
            },
            {
                path: ['removeIconBackground'],
                label: 'Remove item icon backgrounds',
                description: 'Cut the background out of generated item icons with RMBG-1.4, run locally. Downloads ~88MB of model weights the first time.',
                default: true,
                control: { type: 'toggle' },
            },
            {
                path: ['generateImages'],
                label: 'Generate scene images',
                description: 'Give the agent a generate_image tool for visual exposition — establishing a new location, showing something the story needs seen. Adds noticeable latency to those tool calls — the turn waits for the image.',
                default: false,
                control: { type: 'toggle' },
            },
            {
                path: ['stylePreference'],
                label: 'Style',
                description: 'Substituted for {{ @user_style_preference }} in the image prompt templates, so it applies to both item icons and scene images. Blank falls back to "anime screencap".',
                default: '',
                control: { type: 'text' },
            },
            {
                path: ['checkpoint'],
                label: 'Checkpoint',
                description: 'Model checkpoint name. Leave blank to use whatever Forge currently has loaded.',
                default: '',
                control: { type: 'text' },
            },
            {
                path: ['iconSize'],
                label: 'Icon size (px)',
                description: 'Square dimensions for generated item icons.',
                default: 512,
                control: { type: 'slider', min: 128, max: 1024, step: 64 },
            },
        ],
        defaults: {
            endpoint: 'http://localhost:7860',
            generateItemIcons: false,
            removeIconBackground: true,
            generateImages: false,
            stylePreference: '',
            checkpoint: '',
            iconSize: 512,
        },
    },
}

/** Style injected for `{{ @user_style_preference }}` when the user left it blank. */
export const DEFAULT_STYLE_PREFERENCE = 'anime screencap'

/** Typed view of the imageGen feature's resolved values. */
export type ImageGenConfig = {
    endpoint: string
    generateItemIcons: boolean
    removeIconBackground: boolean
    generateImages: boolean
    stylePreference: string
    checkpoint: string
    iconSize: number
}

export type FeatureKey = keyof typeof FEATURES

/**
 * Resolve a feature's effective config: defaults from the registry overlaid
 * with whatever the user has stored. Defaults are applied on READ so old
 * persisted blobs forward-compat onto newly-added params. Disabled by default.
 */
export function resolveFeatureConfig(
    key: FeatureKey,
    stored: FeatureConfig | undefined,
): FeatureConfig {
    const spec = FEATURES[key]
    return {
        enabled: stored?.enabled ?? false,
        values: { ...(spec?.defaults ?? {}), ...(stored?.values ?? {}) },
    }
}

/**
 * Whether a feature is enabled, with a one-time migration for choice prompts'
 * legacy standalone boolean (`enableChoicePrompts`) that predates the registry.
 */
export function featureEnabled(
    prefs: { features?: Record<string, FeatureConfig>; enableChoicePrompts?: boolean },
    key: FeatureKey,
): boolean {
    if (resolveFeatureConfig(key, prefs.features?.[key]).enabled) return true
    if (key === 'choicePrompts' && prefs.enableChoicePrompts === true) return true
    return false
}
