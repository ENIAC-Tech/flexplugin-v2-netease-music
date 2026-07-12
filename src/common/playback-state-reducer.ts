export interface PlaybackStateCursor<T extends Record<string, any>> {
  providerEpoch: number;
  revision: number;
  available: boolean;
  state: T | null;
}

export interface PlaybackStateEvent {
  providerEpoch: number;
  revision: number;
  kind: string;
  payload?: unknown;
  resyncRequired?: true;
}

function isObject(value: unknown): value is Record<string, any> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function cloneJson<T>(value: T, ancestors = new WeakSet<object>()): T {
  if (value === null || typeof value !== 'object') return value;
  if (ancestors.has(value as object)) throw new TypeError('Playback state payload must not be circular');
  ancestors.add(value as object);
  try {
    if (Array.isArray(value)) return value.map((item) => cloneJson(item, ancestors)) as T;
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      result[key] = cloneJson(item, ancestors);
    }
    return result as T;
  } finally {
    ancestors.delete(value as object);
  }
}

function mergePatch(target: unknown, patch: unknown, ancestors = new WeakSet<object>()): unknown {
  if (!isObject(patch)) return cloneJson(patch);
  if (ancestors.has(patch)) throw new TypeError('Playback state delta must not be circular');
  ancestors.add(patch);
  try {
    const result: Record<string, unknown> = isObject(target) ? cloneJson(target) : {};
    for (const [key, value] of Object.entries(patch)) {
      if (value === null) delete result[key];
      else result[key] = mergePatch(result[key], value, ancestors);
    }
    return result;
  } finally {
    ancestors.delete(patch);
  }
}

export function reducePlaybackState<T extends Record<string, any>>(
  current: PlaybackStateCursor<T>,
  event: PlaybackStateEvent
): PlaybackStateCursor<T> {
  const epoch = Number(event.providerEpoch);
  const revision = Number(event.revision);
  if (!Number.isFinite(epoch) || !Number.isFinite(revision)) return current;
  if (epoch < current.providerEpoch || (epoch === current.providerEpoch && revision <= current.revision)) return current;

  const cursor = { providerEpoch: epoch, revision };
  if (event.kind === 'unavailable') return { ...cursor, available: false, state: null };
  if (event.kind === 'available') return { ...cursor, available: true, state: null };

  if (event.kind === 'snapshot') {
    if (!isObject(event.payload)) return { ...cursor, available: true, state: null };
    return { ...cursor, available: true, state: cloneJson(event.payload) as T };
  }

  const contiguous = epoch === current.providerEpoch && revision === current.revision + 1;
  if (event.kind !== 'delta' || event.resyncRequired || !contiguous || current.state === null) {
    return { ...cursor, available: true, state: null };
  }
  return { ...cursor, available: true, state: mergePatch(current.state, event.payload) as T };
}
