import type { ExtensionManifest } from '@shared/extensions'
import type { ExtensionModule } from '../sdk'
import * as choicePrompts from './choice-prompts'
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
}

export const BUILTIN_EXTENSIONS: BuiltinExtension[] = [
    { manifest: choicePrompts.manifest, module: choicePrompts.module },
    { manifest: imageGeneration.manifest, module: imageGeneration.module },
]
