import type { AppNotification, NotificationAction } from "@shared/types";
import { nanoid } from "nanoid";
import { mutate, io, state } from "./server";

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

export const notification = (notification: Omit<AppNotification, 'id' | 'createdAt'>) => {
    const fullNotification: AppNotification = { id: nanoid(), createdAt: Date.now(), ...notification };
    mutate(s => { s.notifications[state.notifications.length] = fullNotification });
    io.emit('notification', fullNotification);
}