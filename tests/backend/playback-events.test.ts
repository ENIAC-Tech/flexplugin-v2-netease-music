import fs from 'fs';
import path from 'path';
import Plugin from '../../src/backend';

const snapshot = (providerEpoch: number, revision: number, payload: any, extra = {}) => ({
  providerUUID: '@aspen/netease-music-link-essentials', channel: 'playback', providerEpoch,
  revision, kind: 'snapshot', timestamp: revision, payload, ...extra
});
const state = (playState = 'Playing') => ({ connected: true, connectionError: null, song: null,
  playState, timeline: { currentTime: 1, totalTime: 2 },
  playMode: { isShuffling: false, repeatMode: 'Off' }, currentLyric: null, lastUpdatedAt: 10 });

function harness(publish = jest.fn().mockResolvedValue(undefined)) {
  const calls: string[] = [];
  const unsubscribe = jest.fn();
  const hostApi: any = {
    __rpcs: new Map(), __unitEvents: [], unit: { setFunction: jest.fn().mockResolvedValue(undefined) },
    plugin: {
      registerRendererStateChannel: jest.fn(async (c: string) => { calls.push(`register:${c}`); }),
      publishRendererState: publish,
      subscribe: jest.fn(async (_u: string, c: string, o: any) => { calls.push(`subscribe:${c}:${o.replayLatest}`); return unsubscribe; }),
      callDependency: jest.fn().mockResolvedValue({ success: true })
    }
  };
  const logger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
  const plugin = new Plugin();
  return { plugin, hostApi, calls, publish, unsubscribe, load: () => plugin.onLoad({ hostApi, logger } as any) };
}

test('registers renderer channel before replay subscription and contains no polling backend', async () => {
  const h = harness(); await h.load();
  expect(h.calls.slice(0, 2)).toEqual(['register:playback', 'subscribe:playback:true']);
  const source = fs.readFileSync(path.resolve(__dirname, '../../src/backend/index.ts'), 'utf8');
  for (const forbidden of ['PLAYBACK_SYNC_INTERVAL_MS', 'playbackSyncTimer', 'playbackSyncInFlight', 'startPlaybackSync', 'clearPlaybackSyncTimer', "source:'poll'", "source: 'poll'"])
    expect(source).not.toContain(forbidden);
});

test('replay lifecycle accepts authoritative snapshots and ignores stale envelopes', async () => {
  const h = harness(); await h.load(); const emit = h.hostApi.__dependencyHandler;
  await emit({ ...snapshot(1, 1, {}), kind: 'available' });
  expect(h.publish).not.toHaveBeenCalled();
  await emit(snapshot(1, 2, state('Playing')));
  await emit(snapshot(1, 2, state('Paused')));
  await emit(snapshot(0, 99, state('Paused')));
  await emit(snapshot(2, 1, state('Paused'), { resyncRequired: true }));
  expect(h.publish.mock.calls.map((c: any[]) => c[1].payload.playState)).toEqual(['Playing', 'Paused']);
  expect(await h.hostApi.__rpcs.get('getPlaybackState')()).toMatchObject({ playState: 'Paused', lyrics: null });
});

test('unavailable publishes disconnected state and unload unsubscribes and prevents late publications', async () => {
  let release!: () => void;
  const first = new Promise<void>((resolve) => { release = resolve; });
  const publish = jest.fn().mockReturnValueOnce(first).mockResolvedValue(undefined);
  const h = harness(publish); await h.load(); const emit = h.hostApi.__dependencyHandler;
  const accepted = emit(snapshot(1, 1, state()));
  await new Promise<void>((resolve) => setImmediate(resolve));
  const unloading = h.plugin.onUnload();
  await emit({ ...snapshot(1, 2, {}), kind: 'unavailable' });
  release(); await accepted; await unloading;
  expect(h.unsubscribe).toHaveBeenCalledTimes(1);
  expect(publish).toHaveBeenCalledTimes(1);
});

test('unavailable creates and publishes a complete deterministic disconnected snapshot', async () => {
  const h = harness(); await h.load();
  await h.hostApi.__dependencyHandler({ ...snapshot(1, 1, {}), kind: 'unavailable' });
  expect(h.publish).toHaveBeenCalledWith('playback', { kind: 'snapshot', payload: expect.objectContaining({
    connected: false, song: null, playState: 'Stopped', timeline: { currentTime: 0, totalTime: 0 },
    playMode: { isShuffling: false, repeatMode: 'Off' }, currentLyric: null
  }) });
});

test('serializes publications and recovers after a rejected publication', async () => {
  let release!: () => void; const order: string[] = [];
  const publish = jest.fn()
    .mockImplementationOnce(() => new Promise<void>((resolve) => { release = () => { order.push('first'); resolve(); }; }))
    .mockImplementationOnce(async () => { order.push('second'); throw new Error('host failed'); })
    .mockImplementationOnce(async () => { order.push('third'); });
  const h = harness(publish); await h.load(); const emit = h.hostApi.__dependencyHandler;
  const a = emit(snapshot(1, 1, state('Playing'))); await new Promise<void>((resolve) => setImmediate(resolve));
  const b = emit(snapshot(1, 2, state('Paused'))); const c = emit(snapshot(1, 3, state('Stopped')));
  expect(publish).toHaveBeenCalledTimes(1); release(); await Promise.all([a, b, c]);
  expect(order).toEqual(['first', 'second', 'third']);
});

test('command RPC does not read dependency playback state or schedule delayed refresh', async () => {
  jest.useFakeTimers(); const h = harness(); await h.load();
  await h.hostApi.__rpcs.get('sendPlayerCommand')('next'); jest.runAllTimers();
  expect(h.hostApi.plugin.callDependency).toHaveBeenCalledTimes(1);
  expect(h.hostApi.plugin.callDependency).not.toHaveBeenCalledWith(expect.anything(), 'getPlaybackState', expect.anything());
  jest.useRealTimers();
});

test('cycled unit tracking initializes, deduplicates unchanged signatures, updates and clears on unload', async () => {
  const h = harness(); await h.load();
  const load = h.hostApi.__unitEvents.find((x: any) => x.type.endsWith('play-pause') && x.event === 'load');
  await load.handler({ payload: { uuid: 'unit-1', serialNumber: 'deck-1' } });
  await new Promise<void>((resolve) => setImmediate(resolve));
  expect(h.hostApi.unit.setFunction).toHaveBeenLastCalledWith('deck-1', 'unit-1', 'play');
  h.hostApi.unit.setFunction.mockClear();
  await h.hostApi.__dependencyHandler(snapshot(1, 1, state('Paused')));
  expect(h.hostApi.unit.setFunction).not.toHaveBeenCalled();
  await h.hostApi.__dependencyHandler(snapshot(1, 2, state('Playing')));
  expect(h.hostApi.unit.setFunction).toHaveBeenCalledWith('deck-1', 'unit-1', 'pause');
  await h.plugin.onUnload();
  await h.hostApi.__dependencyHandler(snapshot(1, 3, state('Paused')));
  expect(h.hostApi.unit.setFunction).toHaveBeenCalledTimes(1);
});
