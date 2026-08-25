import { createSignal } from 'solid-js'

/**
 * Each tab owns its own memory router and `useNavigate` only works inside one.
 * Anything mounted in the app shell leaves its request here for a route to
 * perform.
 */
export type PendingConfigEdit = {
    id: string
    focusEndpoint: boolean
}

export const [pendingConfigEdit, setPendingConfigEdit] = createSignal<PendingConfigEdit | null>(null)
