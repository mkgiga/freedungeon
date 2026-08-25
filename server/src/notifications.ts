import type { AppNotification, NotificationAction } from "@shared/types";
import { nanoid } from "nanoid";
import { mutate, io, state } from "./server";
import { saveNotification, pruneNotifications } from "./db";

/**
 * An error that knows how the user can fix it.
 *
 * Thrown deep (where the condition is actually detectable) and caught shallow
 * (where notifications are raised), so the fix travels with the message instead
 * of the catch site having to re-diagnose it from string matching.
 */
export class ActionableError extends Error {
    constructor(message: string, readonly action: NotificationAction) {
        super(message);
        this.name = 'ActionableError';
    }
}

const KEEP = 500;

/**
 * Raise a notification: record it, count it as unseen, and surface it.
 *
 * Three destinations, matched to three lifetimes.
 *
 *  - The **row** is the history. Written straight to SQL rather than through
 *    app state, because the log is unbounded and state is replicated wholesale.
 *  - The **state entry** is the unseen set. Bounded — opening the Notifications
 *    view clears it — and it is what the badge counts.
 *  - The **socket event** is the toast. An event about something happening now,
 *    dismissed locally per client; making it state would mean a round-trip to
 *    dismiss a four-second popup, and dismissing it on one device would clear
 *    it on another.
 */
export const notification = (notification: Omit<AppNotification, 'id' | 'createdAt'>) => {
    const full: AppNotification = { id: nanoid(), createdAt: Date.now(), ...notification };

    saveNotification(full);
    pruneNotifications(KEEP);

    if (full.show) mutate(s => { s.notifications[full.id] = full });

    io.emit('notification', full);
}

/**
 * Mark everything currently unseen as seen.
 *
 * One stamp rather than a read flag per notification, so clearing the badge is
 * a single action instead of one click per row — and after a restart the unseen
 * set is recomputed from the log against this stamp rather than being lost.
 */
export function markNotificationsSeen(): void {
    mutate(s => { s.userPreferences.notificationsSeenAt = Date.now() });
    mutate(s => { for (const id of Object.keys(state.notifications)) delete s.notifications[id] });
}
