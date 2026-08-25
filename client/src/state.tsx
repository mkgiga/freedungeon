import { createSignal } from 'solid-js';
import { createInitialContext } from '@shared/game-state';
import { createStore, produce, reconcile } from 'solid-js/store';
import { io } from 'socket.io-client';
import type { AppState, CurrentChatState } from '@shared/types';

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
    gameState: createInitialContext(),
    agentRehydration: null,
    createdAt: null,
    updatedAt: null,
    pendingSystemNotice: "",
  } as CurrentChatState,
  isGenerating: false,
  activities: {},
  dependencies: {},
  notifications: {},
  extensionState: {},
  extensions: {},
  userPreferences: {
    theme: 'system',
    activeLLMConfigId: null,
    playerCharacterId: null,
    enableChoicePrompts: false,
    debug: false,
    features: {},
  }
});

const [hydrated, setHydrated] = createSignal(false);

socket.on('init', (data: AppState) => {
  (_setState as Function)(data);
  setHydrated(true);
});

socket.on('state', ({ path, value }: { path: string[], value: any }) => {
  if (!path || path.length === 0 || path.some(p => p == null)) return;
  try {
    (_setState as Function)(...path,
      value !== null && typeof value === 'object' ? reconcile(value) : value);
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

type NotificationListener = (notification: any) => void
let notificationListener: NotificationListener | null = null

export function onNotification(listener: NotificationListener) {
    notificationListener = listener
}

socket.on('notification', (notification: any) => {
    notificationListener?.(notification)
})

export { state, hydrated };