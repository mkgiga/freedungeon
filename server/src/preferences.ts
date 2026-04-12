import path from 'node:path'
import fs from 'node:fs'
import type { UserPreferences } from '@shared/types'

const PREFS_PATH = path.join(import.meta.dirname, '..', 'data', 'preferences.json')

const DEFAULT_PREFERENCES: UserPreferences = {
    activeLLMConfigId: null,
    playerCharacterId: null,
    theme: 'system',
}

export function loadPreferences(): UserPreferences {
    try {
        if (fs.existsSync(PREFS_PATH)) {
            const raw = fs.readFileSync(PREFS_PATH, 'utf-8')
            let parsed = DEFAULT_PREFERENCES;
            try {
                parsed = JSON.parse(raw)
            } catch (e) {
                console.error('Failed to parse preferences, using defaults:', e)
                return { ...DEFAULT_PREFERENCES }
            }
            return { ...DEFAULT_PREFERENCES, ...parsed }
        }
    } catch (e) {
        console.error('Failed to load preferences, using defaults:', e)
    }
    return { ...DEFAULT_PREFERENCES }
}

export function savePreferences(prefs: UserPreferences): void {
    const dir = path.dirname(PREFS_PATH)
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(PREFS_PATH, JSON.stringify(prefs, null, 2))
}
