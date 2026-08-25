import type { SchemaField } from './schema-ui'

/**
 * `schema` uses a FLAT value namespace (single-element field paths), so the
 * resolve-on-read merge stays a shallow merge and newly-added params pick up
 * their defaults without a deep merge.
 */
export type FeatureSpec = {
    key: string
    name: string
    description: string
    schema: SchemaField[]
    defaults: Record<string, unknown>
    state?: Record<string, { default: unknown }>
}

export type FeatureConfig = {
    enabled: boolean
    values: Record<string, unknown>
}

export const FEATURES: Record<string, FeatureSpec> = {
    choicePrompts: {
        key: 'choicePrompts',
        name: 'Multiple-choice prompts',
        description: 'The dungeon master can end a turn with suggested actions. You can still type your own.',
        schema: [],
        defaults: {},
    },

    imageGen: {
        key: 'imageGen',
        name: 'Image generation',
        description: 'Draws pictures on this machine. Downloads about 3 GB the first time.',
        schema: [
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
        ],
        defaults: {
            generateItemIcons: false,
            removeIconBackground: true,
            generateImages: false,
            stylePreference: '',
            iconSize: 512,
        },
    },
}

/** Style injected for `{{ @user_style_preference }}` when the user left it blank. */
export const DEFAULT_STYLE_PREFERENCE = 'anime screencap'

export type ImageGenConfig = {
    generateItemIcons: boolean
    removeIconBackground: boolean
    generateImages: boolean
    stylePreference: string
    iconSize: number
}

export type FeatureKey = keyof typeof FEATURES

/**
 * Defaults are applied on READ, so old persisted blobs forward-compat onto
 * newly-added params. Disabled by default.
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
 * Same resolve-on-read rule as settings: a variable added later arrives with
 * its default on installs that never stored one, without a migration.
 */
export function resolveFeatureState(
    key: FeatureKey,
    stored: Record<string, unknown> | undefined,
): Record<string, unknown> {
    const declared = FEATURES[key]?.state ?? {}
    const defaults = Object.fromEntries(
        Object.entries(declared).map(([name, spec]) => [name, spec.default]),
    )
    return { ...defaults, ...(stored ?? {}) }
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
