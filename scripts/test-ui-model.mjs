import assert from 'node:assert/strict';
import { mkdir, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = resolve(root, '.tmp-tests');
const outFile = resolve(outDir, 'unit-view-model.mjs');
const commonOutFile = resolve(outDir, 'netease-common.mjs');

await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });
await build({
  entryPoints: [resolve(root, 'src/frontend/unit-view-model.ts')],
  outfile: outFile,
  bundle: true,
  platform: 'node',
  format: 'esm'
});
await build({
  entryPoints: [resolve(root, 'src/common/netease.ts')],
  outfile: commonOutFile,
  bundle: true,
  platform: 'node',
  format: 'esm'
});

const model = await import(pathToFileURL(outFile).href);
const common = await import(pathToFileURL(commonOutFile).href);

assert.equal(model.getDeviceLayout({ width: 240, height: 96, viewKind: 'now-playing' }), 'wide');
assert.equal(model.getDeviceLayout({ width: 96, height: 128, viewKind: 'now-playing' }), 'stacked');
assert.equal(model.getDeviceLayout({ width: 96, height: 56, viewKind: 'now-playing' }), 'compact');
assert.equal(model.getDeviceLayout({ width: 64, height: 64, viewKind: 'lyrics' }), 'lyrics');

assert.deepEqual(model.getSetupStepState('loading'), {
  color: 'info',
  icon: 'mdi-loading',
  labelKey: 'working'
});
assert.deepEqual(model.getSetupStepState('success'), {
  color: 'success',
  icon: 'mdi-check-circle',
  labelKey: 'ready'
});
assert.deepEqual(model.getSetupStepState('error'), {
  color: 'warning',
  icon: 'mdi-alert-circle',
  labelKey: 'needsAction'
});

assert.equal(model.clampPercent(-10), 0);
assert.equal(model.clampPercent(42.25), 42.25);
assert.equal(model.clampPercent(180), 100);

assert.deepEqual(
  model.getUnitPixelSize({ geometry: { width: 3, height: 2 } }, { cellWidth: 72, cellHeight: 40, margin: 4 }),
  { width: 224, height: 84 }
);
assert.deepEqual(
  model.getLyricPositionLimits({ width: 224, height: 84 }),
  { x: 224, y: 84 }
);
assert.equal(
  model.getLyricTextStyle({ align: 'right', x: 18, y: 9, color: '#fff', fontSize: 20 }).right,
  '18px',
  'right-aligned lyrics should use X as the right inset so the default main lyric X control is effective'
);
assert.equal(
  model.getLyricTextStyle({ align: 'left', x: 18, y: 9, color: '#fff', fontSize: 20 }).left,
  '18px'
);

const lyricSettings = common.normalizeUnitSettings({
  viewKind: 'lyrics',
  primaryAlign: 'left',
  secondaryAlign: 'center',
  showTranslation: false,
  paddingHorizontal: 22,
  primaryPaddingTop: 11,
  secondaryPaddingTop: 44
});
assert.equal(lyricSettings.primaryAlign, 'left');
assert.equal(lyricSettings.secondaryAlign, 'center');
assert.equal(lyricSettings.secondaryEnabled, false);
assert.equal(lyricSettings.primaryX, 22);
assert.equal(lyricSettings.primaryY, 11);
assert.equal(lyricSettings.secondaryX, 22);
assert.equal(lyricSettings.secondaryY, 44);

assert.equal(
  common.coverImageSource({ cover: 'http://p4.music.126.net/example.jpg' }),
  '',
  'remote http covers must wait for backend base64 conversion instead of violating plugin CSP'
);
assert.equal(
  common.coverImageSource({ cover: { type: 'Url', value: 'https://p4.music.126.net/example.jpg' } }),
  '',
  'remote https covers must wait for backend base64 conversion instead of violating plugin CSP'
);
assert.equal(
  common.coverImageSource({ coverBase64: 'abc123', coverMimeType: 'image/png' }),
  'data:image/png;base64,abc123'
);

const playPauseDefinition = common.UNIT_DEFINITIONS.find((unit) => unit.unitId === 'play-pause');
const playFunction = playPauseDefinition.functions.find((item) => item.functionId === 'play');
assert.equal(playFunction.appearanceOverride.background.backgroundColor, '#1f7a4d');

const playModeDefinition = common.UNIT_DEFINITIONS.find((unit) => unit.unitId === 'play-mode');
assert.equal(
  playModeDefinition.functions.every((item) => !item.appearanceOverride.background),
  true,
  'play mode states should not change the unit background color by default'
);

await rm(outDir, { recursive: true, force: true });
