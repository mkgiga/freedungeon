import { createSignal } from 'solid-js'

/**
 * A navigation request handed from outside the routers to inside them.
 *
 * Each tab owns its own memory router (see app.tsx), and `useNavigate` only
 * works within one. The onboarding overlay is mounted in the app shell, outside
 * all of them, so it can't navigate directly — it leaves the request here, the
 * preferences route picks it up and performs the navigation, and the config
 * editor consumes the `focusEndpoint` hint on arrival.
 */
export type PendingConfigEdit = {
    id: string
    focusEndpoint: boolean
}

export const [pendingConfigEdit, setPendingConfigEdit] = createSignal<PendingConfigEdit | null>(null)
