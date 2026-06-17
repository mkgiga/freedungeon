import { createSignal } from 'solid-js'

/**
 * Single, app-wide dialogue audio buffer. Exactly one TTS clip plays at a time,
 * no matter which message started it — both playback's auto-play and the manual
 * per-message toggle route through here, so they can't overlap. Keyed by audio
 * URL (content-hashed, so identical lines share one clip).
 */
const [playingUrl, setPlayingUrl] = createSignal<string | null>(null)

/** The URL of the clip currently playing, or null. Reactive. */
export const currentDialogueUrl = playingUrl

let audioEl: HTMLAudioElement | null = null

function el(): HTMLAudioElement {
    if (!audioEl) {
        audioEl = new Audio()
        audioEl.addEventListener('ended', () => setPlayingUrl(null))
    }
    return audioEl
}

export function playDialogue(url: string) {
    const a = el()
    a.src = url
    a.currentTime = 0
    a.play().catch(() => setPlayingUrl(null))
    setPlayingUrl(url)
}

/** Stop playback and reset the buffer to the start. */
export function stopDialogue() {
    if (audioEl) {
        audioEl.pause()
        audioEl.currentTime = 0
    }
    setPlayingUrl(null)
}

/** Play `url`, or stop if it's already the one playing. */
export function toggleDialogue(url: string) {
    if (playingUrl() === url) stopDialogue()
    else playDialogue(url)
}
