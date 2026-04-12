import type { AppNotification } from "@shared/types";
import { io, state, setState } from "./server";

export const notification = (notification: Omit<AppNotification, 'id' | 'createdAt'>) => {
    const id = Date.now();
    const createdAt = Date.now();
    const fullNotification: AppNotification = { id, createdAt, ...notification };
    setState('notifications', state.notifications.length, fullNotification);
    io.emit('notification', fullNotification);
}