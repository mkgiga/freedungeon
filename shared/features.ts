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
    tts: {
        key: 'tts',
        name: 'Actor voice acting (DramaBox)',
        description:
            'Voice actors’ dialogue with Resemble AI’s DramaBox TTS. Requires two self-hosted services: an OpenAI-compatible LLM (composes the voice prompt) and a DramaBox synthesis server. English only; GPU-heavy.',
        schema: [
            { path: ['composerEndpoint'], label: 'Composer LLM endpoint', description: 'OpenAI-compatible base URL, e.g. http://127.0.0.1:8080/v1', default: '', control: { type: 'text' } },
            { path: ['composerModel'], label: 'Composer model', description: 'Model name the endpoint serves.', default: '', control: { type: 'text' } },
            { path: ['composerApiKey'], label: 'Composer API key', description: 'Optional. Sent as a Bearer token if set.', default: '', control: { type: 'text' } },
            { path: ['dramaboxEndpoint'], label: 'DramaBox endpoint', description: 'Base URL of the DramaBox HTTP wrapper, e.g. http://127.0.0.1:8077', default: '', control: { type: 'text' } },
            { path: ['cfgScale'], label: 'CFG scale', description: 'Lower = more natural, higher = more text-faithful.', default: 2.5, control: { type: 'slider', min: 1, max: 5, step: 0.1 } },
            { path: ['stgScale'], label: 'STG scale', description: 'Skip-token guidance.', default: 1.5, control: { type: 'slider', min: 0, max: 3, step: 0.1 } },
            { path: ['denoiseRef'], label: 'Denoise voice reference', description: 'Clean up the reference clip before cloning.', default: true, control: { type: 'toggle' } },
        ],
        defaults: {
            composerEndpoint: '',
            composerModel: '',
            composerApiKey: '',
            dramaboxEndpoint: '',
            cfgScale: 2.5,
            stgScale: 1.5,
            denoiseRef: true,
        },
    },
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
