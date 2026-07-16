/**
 * Dirty-tracking for the periodic auto-save. Every state mutation flows
 * through `setState`/`deleteState` in server.ts, which mark the touched
 * asset here; `saveStateToDb` then writes only what changed since the last
 * save instead of sweeping all assets (measured ~1s of synchronous event-
 * loop blocking every 5s on a large library).
 *
 * A collection's `all` flag means "every entry is dirty" — set when a whole
 * collection node is replaced and the individual ids can't be known.
 */

type DirtyCollection = { ids: Set<string>; all: boolean };

const collection = (): DirtyCollection => ({ ids: new Set(), all: false });

export const dirty = {
    chats: collection(),
    actors: collection(),
    notes: collection(),
    llmConfigs: collection(),
    preferences: false,
};

const COLLECTION_KEYS = ['chats', 'actors', 'notes', 'llmConfigs'] as const;

function markCollection(key: (typeof COLLECTION_KEYS)[number], id?: string) {
    if (id === undefined) dirty[key].all = true;
    else dirty[key].ids.add(id);
}

/** Mark dirty state from a setState/deleteState path. */
export function markDirtyFromPath(path: readonly unknown[]) {
    const [root, key, id] = path;
    if (root === 'userPreferences') {
        dirty.preferences = true;
        return;
    }
    if (root !== 'assets') return;
    if (key === undefined) {
        for (const k of COLLECTION_KEYS) markCollection(k);
        return;
    }
    if ((COLLECTION_KEYS as readonly string[]).includes(key as string)) {
        markCollection(key as (typeof COLLECTION_KEYS)[number], typeof id === 'string' ? id : undefined);
    }
}

export function clearDirty() {
    for (const k of COLLECTION_KEYS) {
        dirty[k].ids.clear();
        dirty[k].all = false;
    }
    dirty.preferences = false;
}
