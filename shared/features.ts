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
