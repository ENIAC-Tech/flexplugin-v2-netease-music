import { reducePlaybackState, type PlaybackStateCursor } from '../../src/common/playback-state-reducer';

const initial = <T extends Record<string, any>>(): PlaybackStateCursor<T> => ({
  providerEpoch: -1,
  revision: -1,
  available: false,
  state: null
});

const event = (providerEpoch: number, revision: number, kind: string, payload: any = {}, extra: any = {}) => ({
  pluginUUID: '@aspen/netease-music', channel: 'playback', providerEpoch, revision, kind,
  timestamp: revision, payload, ...extra
});

test('replays available then snapshot into authoritative state', () => {
  const waiting = reducePlaybackState(initial<any>(), event(1, 1, 'available'));
  expect(waiting).toEqual({ providerEpoch: 1, revision: 1, available: true, state: null });
  expect(reducePlaybackState(waiting, event(1, 2, 'snapshot', { song: 'A' }))).toEqual({
    providerEpoch: 1, revision: 2, available: true, state: { song: 'A' }
  });
});

test('rejects stale epochs and revisions without changing identity', () => {
  const current = { providerEpoch: 2, revision: 4, available: true, state: { song: 'A' } };
  expect(reducePlaybackState(current, event(1, 99, 'snapshot', { song: 'old epoch' }))).toBe(current);
  expect(reducePlaybackState(current, event(2, 4, 'snapshot', { song: 'same revision' }))).toBe(current);
  expect(reducePlaybackState(current, event(2, 3, 'snapshot', { song: 'old revision' }))).toBe(current);
});

test('higher epoch and available clear stale state while waiting for a snapshot', () => {
  const current = { providerEpoch: 1, revision: 8, available: true, state: { song: 'A' } };
  expect(reducePlaybackState(current, event(2, 1, 'delta', { playState: 'Paused' }))).toEqual({
    providerEpoch: 2, revision: 1, available: true, state: null
  });
  expect(reducePlaybackState(current, event(1, 9, 'available'))).toEqual({
    providerEpoch: 1, revision: 9, available: true, state: null
  });
});

test('unavailable clears availability and state', () => {
  const current = { providerEpoch: 1, revision: 2, available: true, state: { song: 'A' } };
  expect(reducePlaybackState(current, event(1, 3, 'unavailable'))).toEqual({
    providerEpoch: 1, revision: 3, available: false, state: null
  });
});

test('complete snapshot applies despite resyncRequired', () => {
  const current = { providerEpoch: 1, revision: 1, available: true, state: null };
  expect(reducePlaybackState(current, event(1, 4, 'snapshot', { song: 'fresh' }, { resyncRequired: true }))).toEqual({
    providerEpoch: 1, revision: 4, available: true, state: { song: 'fresh' }
  });
});

test('non-snapshot resync and revision gaps clear state', () => {
  const current = { providerEpoch: 1, revision: 3, available: true, state: { song: 'A' } };
  expect(reducePlaybackState(current, event(1, 4, 'delta', { song: 'B' }, { resyncRequired: true }))).toEqual({
    providerEpoch: 1, revision: 4, available: true, state: null
  });
  expect(reducePlaybackState(current, event(1, 5, 'delta', { song: 'B' }))).toEqual({
    providerEpoch: 1, revision: 5, available: true, state: null
  });
});

test('contiguous delta uses RFC 7396 merge semantics including array replacement and null deletion', () => {
  const original = { song: { name: 'A', album: 'X' }, list: [1, 2], keep: true };
  const current = { providerEpoch: 1, revision: 3, available: true, state: original };
  const next = reducePlaybackState(current, event(1, 4, 'delta', {
    song: { name: 'B', album: null }, list: [3]
  }));
  expect(next.state).toEqual({ song: { name: 'B' }, list: [3], keep: true });
  expect(original).toEqual({ song: { name: 'A', album: 'X' }, list: [1, 2], keep: true });
});

test('is pure and transactional when malformed merge input throws', () => {
  const state = Object.freeze({ nested: Object.freeze({ value: 1 }) });
  const current = Object.freeze({ providerEpoch: 1, revision: 1, available: true, state });
  const circular: any = {}; circular.self = circular;
  expect(() => reducePlaybackState(current, event(1, 2, 'delta', circular))).toThrow();
  expect(current).toEqual({ providerEpoch: 1, revision: 1, available: true, state: { nested: { value: 1 } } });
});
