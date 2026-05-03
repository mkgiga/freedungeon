import { createSignal } from 'solid-js'

interface BeforeInstallPromptEvent extends Event {
  readonly platforms: ReadonlyArray<string>
  prompt(): Promise<void>
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
}

let deferred: BeforeInstallPromptEvent | null = null

const detectStandalone = () =>
  window.matchMedia('(display-mode: standalone)').matches ||
  (navigator as Navigator & { standalone?: boolean }).standalone === true

const [installAvailable, setInstallAvailable] = createSignal(false)
const [isStandalone, setIsStandalone] = createSignal(detectStandalone())

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault()
  deferred = e as BeforeInstallPromptEvent
  setInstallAvailable(true)
})

window.addEventListener('appinstalled', () => {
  deferred = null
  setInstallAvailable(false)
  setIsStandalone(true)
})

window.matchMedia('(display-mode: standalone)').addEventListener('change', (e) => {
  setIsStandalone(e.matches)
})

export { installAvailable, isStandalone }

export async function triggerInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
  if (!deferred) return 'unavailable'
  await deferred.prompt()
  const { outcome } = await deferred.userChoice
  deferred = null
  setInstallAvailable(false)
  return outcome
}
