import fs from 'fs';
import path from 'path';

const source = fs.readFileSync(path.resolve(__dirname, '../../src/frontend/UnitView.vue'), 'utf8');

test('Unit View subscribes once with replay, stores unsubscribe, and removes polling/state RPC', () => {
  expect(source.match(/subscribeRendererState(?:<[^>]+>)?\s*\(/g)).toHaveLength(1);
  expect(source).toMatch(/subscribeRendererState[\s\S]*['"]playback['"][\s\S]*replayLatest:\s*true/);
  expect(source).toMatch(/onUnmounted[\s\S]*playbackLifecycle\.unmount\(\)/);
  expect(source).not.toContain("backendRpc<PlaybackState>('getPlaybackState')");
  expect(source).not.toMatch(/pollTimer|setInterval\s*\(|setTimeout\s*\([\s\S]*refresh/);
});

test('animation frame updates only local clock and is cancelled on unmount', () => {
  const frame = source.match(/requestFrame:[\s\S]*?onFrame:[^\n]+/)?.[0] ?? '';
  expect(frame).toContain('requestAnimationFrame');
  expect(frame).toContain('cancelAnimationFrame');
  expect(frame).not.toMatch(/backendRpc|bridge\.|subscribeRendererState/);
  expect(source).toMatch(/onUnmounted[\s\S]*playbackLifecycle\.unmount\(\)/);
});

test('cover and current lyric rendering remain present', () => {
  expect(source).toContain(':src="coverSrc"');
  expect(source).toContain('currentLine');
  expect(source).toContain('lyricSegments');
});
