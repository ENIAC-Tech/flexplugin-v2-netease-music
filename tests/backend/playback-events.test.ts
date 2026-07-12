import fs from 'fs';
import path from 'path';
import Plugin from '../../src/backend';
import { reducePlaybackState } from '../../src/common/playback-state-reducer';
import { coverImageSource } from '../../src/common/netease';
import { RendererStateRegistry } from '../../../../FlexStudio/src/main/plugin/renderer-state-registry';

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
  expect(h.hostApi.__rpcs.has('getPlaybackState')).toBe(false);
  const source = fs.readFileSync(path.resolve(__dirname, '../../src/backend/index.ts'), 'utf8');
  for (const forbidden of ['getPlaybackStateForRenderer', "registerRendererRpc('getPlaybackState'", 'PLAYBACK_SYNC_INTERVAL_MS', 'playbackSyncTimer', 'playbackSyncInFlight', 'startPlaybackSync', 'clearPlaybackSyncTimer', "source:'poll'", "source: 'poll'"])
    expect(source).not.toContain(forbidden);
});

test('replay lifecycle accepts authoritative snapshots and ignores stale envelopes', async () => {
  const h = harness(); await h.load(); const emit = h.hostApi.__dependencyHandler;
  await emit({ ...snapshot(1, 1, {}), kind: 'available' });
  expect(h.publish).toHaveBeenCalledTimes(1);
  h.publish.mockClear();
  await emit(snapshot(1, 2, state('Playing')));
  await emit(snapshot(1, 2, state('Paused')));
  await emit(snapshot(0, 99, state('Paused')));
  await emit(snapshot(2, 1, state('Paused'), { resyncRequired: true }));
  expect(h.publish.mock.calls.map((c: any[]) => c[1].payload.playState)).toEqual(['Playing', 'Paused']);
  expect(h.publish.mock.calls.at(-1)?.[1].payload).toMatchObject({ playState: 'Paused' });
});

test('unavailable publishes disconnected state and unload unsubscribes and prevents late publications', async () => {
  let release!: () => void;
  const first = new Promise<void>((resolve) => { release = resolve; });
  const publish = jest.fn().mockReturnValueOnce(first).mockResolvedValue(undefined);
  const h = harness(publish); await h.load(); const emit = h.hostApi.__dependencyHandler;
  const accepted = emit(snapshot(1, 1, state()));
  await new Promise<void>((resolve) => setImmediate(resolve));
  const unloading = h.plugin.onUnload();
  const late = emit({ ...snapshot(1, 2, {}), kind: 'unavailable' });
  release(); await accepted; await unloading; await late;
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

test('projects exact compact renderer payload without lyrics base64 or arbitrary fields', async () => {
  const h = harness(); await h.load();
  const huge = 'x'.repeat(100_000);
  await h.hostApi.__dependencyHandler(snapshot(1, 1, {
    ...state(), lyrics: { lines: [{ originalLyric: huge }] }, unknown: huge,
    song: { songName: 'Song', authorName: 'Artist', albumName: 'Album', ncmId: 1, duration: 2,
      originalCoverUrl: 'https://example.test/a.jpg', coverUrl: 'data:image/png;base64,' + huge,
      picUrl: 'https://example.test/p.jpg', coverBase64: huge, cover: { type: 'Base64', value: huge },
      album: { picUrl: 'https://example.test/ap.jpg', coverUrl: 'data:image/png;base64,' + huge }, extra: huge }
  }));
  const payload = h.publish.mock.calls[0][1].payload;
  expect(Object.keys(payload)).toEqual(['connected', 'connectionError', 'song', 'playState', 'timeline', 'playMode', 'currentLyric', 'lastUpdatedAt']);
  expect(Object.keys(payload.song)).toEqual(['songName', 'authorName', 'albumName', 'ncmId', 'duration', 'originalCoverUrl', 'picUrl', 'album']);
  expect(payload.song.coverUrl).toBeUndefined();
  expect(payload.song.album.coverUrl).toBeUndefined();
  expect(JSON.stringify(payload)).not.toContain(huge);
  expect(Buffer.byteLength(JSON.stringify(payload), 'utf8')).toBeLessThan(64 * 1024);
});

test('dependency snapshot flows through renderer publication and reducer to displayed fields', async () => {
  const deliveries: any[] = [];
  const registry = new RendererStateRegistry({
    now: () => 123,
    createDeliveryId: () => `delivery-${deliveries.length + 1}`,
    sendMessage: (_session, message) => deliveries.push(message)
  });
  registry.registerProviderChannel('@aspen/netease-music', 'playback');
  const publish = jest.fn(async (channel: string, update: any) => {
    registry.publish('@aspen/netease-music', channel, update);
  });
  const h = harness(publish); await h.load();
  await h.hostApi.__dependencyHandler(snapshot(7, 1, {
    ...state(),
    song: { songName: 'Event Song', authorName: 'Event Artist', originalCoverUrl: 'https://example.test/cover.jpg' },
    currentLyric: { lineIndex: 0, wordIndex: 1, line: { originalLyric: 'Event lyric' }, nextLine: null }
  }));
  registry.subscribe('@aspen/netease-music', 'unit-view', 'playback', 'subscription', { replayLatest: true });
  expect(deliveries[0].envelope).toMatchObject({ kind: 'available', providerEpoch: 1, revision: 0 });
  let rendered = reducePlaybackState(
    { providerEpoch: -1, revision: -1, available: false, state: null },
    deliveries[0].envelope
  );
  registry.acknowledge('@aspen/netease-music', 'unit-view', 'subscription', deliveries[0].deliveryId);
  expect(deliveries[1].envelope).toMatchObject({ kind: 'snapshot', providerEpoch: 1, revision: 1 });
  rendered = reducePlaybackState(rendered, deliveries[1].envelope);
  expect(rendered.state).toMatchObject({
    song: { songName: 'Event Song', originalCoverUrl: 'https://example.test/cover.jpg' },
    currentLyric: { line: { originalLyric: 'Event lyric' } }
  });
  expect(coverImageSource(rendered.state?.song)).toBe('https://example.test/cover.jpg');
  registry.acknowledge('@aspen/netease-music', 'unit-view', 'subscription', deliveries[1].deliveryId);
});

test('serializes concurrent Unit changes and publications when setFunction is deferred', async () => {
  const h = harness(); await h.load();
  const load = h.hostApi.__unitEvents.find((x: any) => x.type.endsWith('play-pause') && x.event === 'load');
  await load.handler({ payload: { uuid: 'u', serialNumber: 's' } });
  await new Promise<void>((resolve) => setImmediate(resolve)); h.hostApi.unit.setFunction.mockClear(); h.publish.mockClear();
  let release!: () => void;
  h.hostApi.unit.setFunction.mockImplementationOnce(() => new Promise<void>((resolve) => { release = resolve; })).mockResolvedValue(undefined);
  const first = h.hostApi.__dependencyHandler(snapshot(1, 1, state('Playing')));
  await new Promise<void>((resolve) => setImmediate(resolve));
  const second = h.hostApi.__dependencyHandler(snapshot(1, 2, state('Paused')));
  expect(h.publish).not.toHaveBeenCalled(); release(); await Promise.all([first, second]);
  expect(h.publish.mock.calls.map((c: any[]) => c[1].payload.playState)).toEqual(['Playing', 'Paused']);
  expect(h.hostApi.unit.setFunction.mock.calls.map((c: any[]) => c[2])).toEqual(['pause', 'play']);
});

test('higher epoch available clears stale cache and Units before retained snapshot', async () => {
  const h = harness(); await h.load();
  const load = h.hostApi.__unitEvents.find((x: any) => x.type.endsWith('play-pause') && x.event === 'load');
  await load.handler({ payload: { uuid: 'u', serialNumber: 's' } }); await new Promise<void>((r) => setImmediate(r));
  await h.hostApi.__dependencyHandler(snapshot(1, 1, state('Playing'))); h.publish.mockClear(); h.hostApi.unit.setFunction.mockClear();
  await h.hostApi.__dependencyHandler({ ...snapshot(2, 1, {}), kind: 'available' });
  expect(h.publish.mock.calls.at(-1)?.[1].payload).toMatchObject({ connected: false, playState: 'Stopped' });
  expect(h.hostApi.unit.setFunction).toHaveBeenLastCalledWith('s', 'u', 'play');
  expect(h.publish).toHaveBeenCalledTimes(1);
  await h.hostApi.__dependencyHandler(snapshot(2, 2, state('Playing')));
  expect(h.publish.mock.calls.at(-1)?.[1].payload).toMatchObject({ connected: true, playState: 'Playing' });
});

test('play-mode and unavailable/resync lifecycle refresh loaded Units', async () => {
  const h = harness(); await h.load();
  const load = h.hostApi.__unitEvents.find((x: any) => x.type.endsWith('play-mode') && x.event === 'load');
  await load.handler({ payload: { uuid: 'm', serialNumber: 's' } }); await new Promise<void>((r) => setImmediate(r));
  expect(h.hostApi.unit.setFunction).toHaveBeenLastCalledWith('s', 'm', 'sequential');
  await h.hostApi.__dependencyHandler(snapshot(1, 1, { ...state(), playMode: { isShuffling: true, repeatMode: 'Off' } }));
  expect(h.hostApi.unit.setFunction).toHaveBeenLastCalledWith('s', 'm', 'shuffle');
  await h.hostApi.__dependencyHandler({ ...snapshot(1, 2, {}), kind: 'unavailable' });
  expect(h.hostApi.unit.setFunction).toHaveBeenLastCalledWith('s', 'm', 'sequential');
  await h.hostApi.__dependencyHandler({ ...snapshot(1, 3, {}), kind: 'delta', resyncRequired: true });
  expect(h.publish.mock.calls.at(-1)?.[1].payload).toMatchObject({ connected: false, playState: 'Stopped' });
});

test('frontend Vue sources are valid UTF-8 without replacement characters', () => {
  const frontend = path.resolve(__dirname, '../../src/frontend');
  for (const file of fs.readdirSync(frontend).filter((name) => name.endsWith('.vue'))) {
    expect(fs.readFileSync(path.join(frontend, file), 'utf8')).not.toContain('�');
  }
});

test.each([
  ['connectionError', { connectionError: '故障'.repeat(100_000) }],
  ['playState', { playState: '播放'.repeat(100_000) }],
  ['repeatMode', { playMode: { isShuffling: false, repeatMode: '循环'.repeat(100_000) } }],
  ['combined', { connectionError: '错'.repeat(100_000), playState: '播'.repeat(100_000), playMode: { isShuffling: false, repeatMode: '循'.repeat(100_000) } }]
])('never publishes an oversized compact payload for huge %s', async (_name, pathological) => {
  const h = harness(); await h.load();
  await h.hostApi.__dependencyHandler(snapshot(1, 1, { ...state(), ...pathological }));
  const payload = h.publish.mock.calls[0][1].payload;
  expect(Buffer.byteLength(JSON.stringify(payload), 'utf8')).toBeLessThanOrEqual(64 * 1024);
  expect(Object.keys(payload)).toEqual(['connected', 'connectionError', 'song', 'playState', 'timeline', 'playMode', 'currentLyric', 'lastUpdatedAt']);
});

test('normalizes non-finite timeline values to finite defaults', async () => {
  const h = harness(); await h.load();
  await h.hostApi.__dependencyHandler(snapshot(1, 1, { ...state(), timeline: { currentTime: Infinity, totalTime: NaN } }));
  const timeline = h.publish.mock.calls[0][1].payload.timeline;
  expect(timeline).toEqual({ currentTime: 0, totalTime: 0 });
  expect(Number.isFinite(timeline.currentTime)).toBe(true);
  expect(Number.isFinite(timeline.totalTime)).toBe(true);
});
