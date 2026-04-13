import { createStore, produce } from 'solid-js/store';
import { io } from 'socket.io-client';
import type { AppState, CurrentChatState } from '@shared/types';

const socket = io('http://localhost:8079');
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
  if (path[0] === 'isGenerating' || path.includes('isGenerating')) {
    console.log('[state] isGenerating update received:', { path, value });
  }
  (_setState as Function)(...path, value);
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