/**
 * Interaction cues.
 *
 * A module-level singleton rather than a context or a provider: sound is
 * fire-and-forget and has no reactive surface, so callers should not have to
 * be components to reach it. `playCue('drop')` works from an event handler, a
 * plain function, or a module that never renders anything.
 *
 * Howler owns the audio graph. It handles the parts that are tedious to get
 * right by hand — decoding each file once and pooling the nodes that play it,
 * and unlocking the AudioContext on the first user gesture, since browsers
 * refuse to start one before that. Calling play() on a Howl that is still
 * loading is safe; Howler queues it and plays when the buffer arrives, so a
 * cue never has to be preloaded to be requested.
 *
 * Files come from scripts/gen-sfx.ts.
 */

import { Howl } from 'howler'
import { state } from './state'

export type Cue = 'message' | 'pick-up' | 'drop'

/** Deliberately low. These confirm an action; they are not notifications. */
const VOLUME = 0.5

const loaded = new Map<Cue, Howl>()

const soundEnabled = () => state.userPreferences.interface?.sound?.enabled ?? true

function howlFor(cue: Cue): Howl {
    let howl = loaded.get(cue)
    if (!howl) {
        howl = new Howl({ src: [`/sfx/${cue}.wav`], volume: VOLUME })
        loaded.set(cue, howl)
    }
    return howl
}

/**
 * Play an interaction cue. Silent when the user has sound switched off, and
 * never throws — a cue that fails to load or play is not worth interrupting
 * the interaction it was decorating.
 */
export function playCue(cue: Cue) {
    if (!soundEnabled()) return
    try {
        howlFor(cue).play()
    } catch {
        // Audio is decoration. Losing it should cost nothing.
    }
}
