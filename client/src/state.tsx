import { createSignal } from 'solid-js';
import { createStore, produce } from 'solid-js/store';
import { io } from 'socket.io-client';
import type { AppState, CurrentChatState } from '@shared/types';

// Socket.io runs on a dedicated port alongside the HTTP server. Use whatever
// host the page itself came from so this works over LAN too (localhost on the
// client device won't reach the server machine).
//
// The port is derived from the one we were served on rather than hardcoded:
// the desktop shell picks a free pair at launch, and a baked-in 8079 would
// leave the app rendering fine while silently never syncing. The server keeps
// the same +1 convention. Falls back to the default pair under the vite dev
// server, which is served on 5173 and proxies to 8078.
const SOCKET_PORT = (() => {
  const served = Number(window.location.port)
  return served && served !== 5173 ? served + 1 : 8079
})()
const socket = io(`${window.location.protocol}//${window.location.hostname}:${SOCKET_PORT}`);
const [state, _setState] = createStore<AppState>({
  assets: {
    actors: {},
    notes: {},
    images: {},
    llmConfigs: {},
    chats: {},
  },
  currentChat: {
    id: null,
    title: '',
    assets: {
      actors: [],
      notes: {},
      images: [],
    },
    messages: {},
    gameState: { inventory: {}, itemDefs: {}, scene: { actors: { active: {}, offscreen: {} } }, flags: {} },
    agentRehydration: null,
    createdAt: null,
    updatedAt: null,
    pendingSystemNotice: "",
  } as CurrentChatState,
  isGenerating: false,
  activities: {},
  dependencies: {},
  notifications: [],
  extensionState: {},
  userPreferences: {
    theme: 'system',
    activeLLMConfigId: null,
    playerCharacterId: null,
    enableChoicePrompts: false,
    debug: false,
    features: {},
  }
});


/**
 * Whether the server's first full state has arrived.
 *
 * Until it does, the store holds its empty defaults — which are indistinguishable
 * from real answers. Anything that decides *whether to appear* from state has to
 * wait for this, or it renders on the defaults and then takes itself back: the
 * onboarding overlay flashed up on every load for exactly that reason, because
 * "no onboarding timestamp yet" and "onboarding never done" look identical.
 */
const [hydrated, setHydrated] = createSignal(false);

socket.on('init', (data: AppState) => {
  (_setState as Function)(data);
  setHydrated(true);
});

socket.on('state', ({ path, value }: { path: string[], value: any }) => {
  if (!path || path.length === 0 || path.some(p => p == null)) return;
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
export { state, hydrated };