import type { AppNotification } from "@shared/types";
import { nanoid } from "nanoid";
import { io, state, setState } from "./server";

export const notification = (notification: Omit<AppNotification, 'id' | 'createdAt'>) => {
    const fullNotification: AppNotification = { id: nanoid(), createdAt: Date.now(), ...notification };
    setState('notifications', state.notifications.length, fullNotification);
    io.emit('notification', fullNotification);
}