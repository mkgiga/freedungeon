import { createSignal } from 'solid-js'

/**
 * A navigation request handed from outside the routers to inside them.
 *
 * Each tab owns its own memory router and `useNavigate` only works within one.
 * The onboarding overlay is mounted in the app shell, outside all of them, so
 * it leaves the request here for the preferences route to perform.
 */
export type PendingConfigEdit = {
    id: string
    focusEndpoint: boolean
}

export const [pendingConfigEdit, setPendingConfigEdit] = createSignal<PendingConfigEdit | null>(null)
