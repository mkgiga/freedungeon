import type { AppNotification, NotificationAction } from "@shared/types";
import { nanoid } from "nanoid";
import { mutate, io, state } from "./server";
import { saveNotification, pruneNotifications } from "./db";

/**
 * Thrown deep, where the condition is detectable, and caught shallow, where
 * notifications are raised - so the catch site doesn't re-diagnose by string
 * matching.
 */
export class ActionableError extends Error {
    constructor(message: string, readonly action: NotificationAction) {
        super(message);
        this.name = 'ActionableError';
    }
}

const KEEP = 500;

/**
 * Raise a notification. Three destinations, three lifetimes:
 *
 *  - row: the history. Straight to SQL - the log is unbounded and state is
 *    replicated wholesale.
 *  - state entry: the unseen set, cleared by opening Notifications. The badge
 *    counts these.
 *  - socket event: the toast, dismissed locally per client.
 */
export const notification = (notification: Omit<AppNotification, 'id' | 'createdAt'>) => {
    const full: AppNotification = { id: nanoid(), createdAt: Date.now(), ...notification };

    saveNotification(full);
    pruneNotifications(KEEP);

    if (full.show) mutate(s => { s.notifications[full.id] = full });

    io.emit('notification', full);
}

/**
 * One stamp rather than a per-row read flag, so the unseen set survives a
 * restart by being recomputed from the log against it.
 */
export function markNotificationsSeen(): void {
    mutate(s => { s.userPreferences.notificationsSeenAt = Date.now() });
    mutate(s => { for (const id of Object.keys(state.notifications)) delete s.notifications[id] });
}
