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
    /**
     * Working state this feature owns, declared so it has defaults and a home.
     *
     * Distinct from `schema`/`defaults`, which are *settings* — user-authored,
     * rendered into the preferences form, and rewritten wholesale on change.
     * This never appears in a form; it's what the feature keeps for itself, and
     * it lives in `state.extensionState[key]` where writes persist and reach
     * the client through the same setState funnel as everything else.
     */
    state?: Record<string, { default: unknown }>
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
        description: 'The dungeon master can end a turn with suggested actions. You can still type your own.',
        schema: [],
        defaults: {},
    },

    imageGen: {
        key: 'imageGen',
        name: 'Image generation',
        description: 'Needs Stable Diffusion WebUI Forge running with --api.',
        // Not a setting: nothing renders it and the user never edits it. It is
        // here so the bag exists and the value has a default.
        state: {
            /** Last checkpoint Forge reported, to skip a redundant switch. */
            lastCheckpoint: { default: '' },
        },
        schema: [
            {
                path: ['endpoint'],
                label: 'Forge API endpoint',
                description: 'Base URL of the Forge server.',
                default: 'http://localhost:7860',
                control: { type: 'text' },
            },
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
                path: ['checkpoint'],
                label: 'Checkpoint',
                description: 'Blank uses whatever Forge has loaded.',
                default: '',
                control: { type: 'text' },
            },
            {
                path: ['iconSize'],
                label: 'Icon size (px)',
                // No description — the label already says everything it said.
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
 * A feature's state, defaults applied on read.
 *
 * Same resolve-on-read rule as settings, for the same reason: a variable added
 * in a later version has to arrive with its default for installs that never
 * stored one, without a migration.
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
