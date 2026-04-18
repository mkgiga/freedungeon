import { createStore, produce } from 'solid-js/store';
import { io } from 'socket.io-client';
import type { AppState, CurrentChatState } from '@shared/types';

// Socket.io runs on a dedicated port alongside the HTTP server. Use whatever
// host the page itself came from so this works over LAN too (localhost on the
// client device won't reach the server machine).
const SOCKET_PORT = 8079
const socket = io(`${window.location.protocol}//${window.location.hostname}:${SOCKET_PORT}`);
const [state, _setState] = createStore<AppState>({
  assets: {
    actors: {},
    notes: {},
    llmConfigs: {},
    chats: {},
  },
  currentChat: {
    id: null,
    title: '',
    assets: {
      actors: [],
      notes: [],
    },
    messages: {},
    gameState: { inventory: {}, hp: 100 },
    createdAt: null,
    updatedAt: null,
  } as CurrentChatState,
  isGenerating: false,
  notifications: [],
  userPreferences: {
    theme: 'system',
    activeLLMConfigId: null,
    playerCharacterId: null,
  }
});


socket.on('init', (data: AppState) => {
  (_setState as Function)(data);
});

socket.on('state', ({ path, value }: { path: string[], value: any }) => {
  if (!path || path.length === 0 || path.some(p => p == null)) return;
  const valueSummary = value === null || typeof value !== 'object'
    ? value
    : Array.isArray(value) ? `[array len=${value.length}]` : `{${Object.keys(value).join(',')}}`;
  console.log('[CLIENT/recv state]', path, valueSummary);
  try {
    (_setState as Function)(...path, value);
  } catch (e) {
    console.error('[CLIENT/setState THREW]', path, e);
  }
});

socket.on('delete', ({ path, key }: { path: string[], key: string }) => {
  _setState(produce((s: any) => {
    let target = s
    for (const p of path) target = target[p]
    delete target[key]
  }))
});


// Notification bridge — ToastProvider registers a callback to show toasts from server-pushed notifications
type NotificationListener = (notification: any) => void
let notificationListener: NotificationListener | null = null

export function onNotification(listener: NotificationListener) {
    notificationListener = listener
}

socket.on('notification', (notification: any) => {
    notificationListener?.(notification)
})

// read-only export — components use state, never setState directly
export { state };