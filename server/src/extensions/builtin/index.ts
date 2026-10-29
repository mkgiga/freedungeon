import type { ExtensionManifest } from '@shared/extensions'
import type { ExtensionModule } from '../sdk'
import * as choicePrompts from './choice-prompts'
import * as diceRolls from './dice-rolls'
import * as imageGeneration from './image-generation'

/**
 * The app's own optional behaviour, expressed as extensions - same manifest,
 * same `activate`, same host, same switch. They differ from a dropped-in
 * folder in two ways only: they ship in the bundle rather than on disk, and
 * they own the reserved `core.` namespace so nothing can impersonate one.
 *
 * Adding one means adding a file here, not a branch in the app.
 */
export type BuiltinExtension = {
    manifest: ExtensionManifest
    module: ExtensionModule
    /**
     * The app doesn't work without it, so the list gives it no switch and
     * `setExtensionEnabled` refuses to turn it off. For systems that were
     * rewritten as extensions to keep the engine honest, not for features the
     * user is meant to choose.
     */
    required?: boolean
}

export const BUILTIN_EXTENSIONS: BuiltinExtension[] = [
    { manifest: choicePrompts.manifest, module: choicePrompts.module },
    { manifest: diceRolls.manifest, module: diceRolls.module },
    { manifest: imageGeneration.manifest, module: imageGeneration.module },
]
