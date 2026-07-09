<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { useFlexBridge } from '@flexsdk/runtime/vue';
import {
  coverImageSource,
  DEFAULT_PLAYBACK_STATE,
  formatTime,
  normalizeUnitSettings,
  type PlaybackState,
  playModeIcon,
  playModeLabel,
  type PlayerCommand,
  splitLyricText
} from '../common/netease';
import { clampPercent, getDeviceLayout, getLyricTextStyle } from './unit-view-model';

const { isReady, bridge, backendRpc, typeId, unitData, language } = useFlexBridge();

const rootEl = ref<HTMLElement | null>(null);
const viewport = ref({ width: 0, height: 0 });
const state = ref<PlaybackState>({ ...DEFAULT_PLAYBACK_STATE });
const animationNow = ref(Date.now());
const lyricCursor = ref('');
const lyricCursorStartedAt = ref(Date.now());
const errorMessage = ref('');
const reportedCoverDiagnostics = new Set<string>();

let pollTimer: ReturnType<typeof setInterval> | null = null;
let animationTimer: ReturnType<typeof setInterval> | null = null;
let resizeObserver: ResizeObserver | null = null;

const text = computed(() => language.value.startsWith('zh') ? zhText : enText);
const settings = computed(() => normalizeUnitSettings(unitData.value, typeId.value));
const layout = computed(() => getDeviceLayout({
  width: viewport.value.width,
  height: viewport.value.height,
  viewKind: settings.value.viewKind
}));
const coverSrc = computed(() => coverImageSource(state.value.song));
const isPlaying = computed(() => state.value.playState === 'Playing');
const displayedCurrentTime = computed(() => {
  const base = state.value.timeline.currentTime || 0;
  if (!isPlaying.value || !state.value.lastUpdatedAt) return base;
  return Math.min(base + (animationNow.value - state.value.lastUpdatedAt), state.value.timeline.totalTime || base);
});
const progressPercent = computed(() => {
  const total = state.value.timeline.totalTime;
  if (!total) return 0;
  return clampPercent((displayedCurrentTime.value / total) * 100);
});
const currentLine = computed(() => {
  const lineIndex = Number(state.value.currentLyric?.lineIndex ?? -1);
  const canonicalLine = lineIndex >= 0 ? state.value.lyrics?.lines?.[lineIndex] : null;
  return {
    ...(canonicalLine ?? {}),
    ...(state.value.currentLyric?.line ?? {})
  };
});
const secondaryLyric = computed(() => {
  if (settings.value.secondaryEnabled !== false && currentLine.value?.translatedLyric) {
    return currentLine.value.translatedLyric;
  }
  if (settings.value.secondaryEnabled === false) return '';
  return state.value.currentLyric?.nextLine?.originalLyric ?? '';
});
const lyricSegments = computed(() => {
  const lyricText = currentLine.value?.originalLyric ?? state.value.song?.songName ?? '';
  const wordIndex = Number(state.value.currentLyric?.wordIndex ?? -1);
  const highlight = settings.value.highlightWord !== false && wordIndex >= 0;
  const parts = splitLyricText(lyricText);
  let logicalIndex = -1;
  const activeCharCount = Math.floor((animationNow.value - lyricCursorStartedAt.value) / 35);

  return parts.map((part) => {
    if (/^\s+$/.test(part)) {
      return { text: part, className: 'normal', chars: [] as Array<{ text: string; highlighted: boolean }> };
    }

    logicalIndex += 1;
    if (!highlight) return { text: part, className: 'active', chars: [] };
    if (logicalIndex < wordIndex) return { text: part, className: 'active', chars: [] };
    if (logicalIndex > wordIndex) return { text: part, className: 'normal', chars: [] };

    return {
      text: part,
      className: 'current',
      chars: Array.from(part).map((char, index) => ({
        text: char,
        highlighted: index < activeCharCount
      }))
    };
  });
});
const controlIcon = computed(() => {
  switch (settings.value.viewKind) {
    case 'previous':
      return 'mdi-skip-previous';
    case 'next':
      return 'mdi-skip-next';
    case 'play-mode':
      return playModeIcon(state.value.playMode);
    default:
      return isPlaying.value ? 'mdi-pause' : 'mdi-play';
  }
});
const controlLabel = computed(() => {
  switch (settings.value.viewKind) {
    case 'previous':
      return text.value.previous;
    case 'next':
      return text.value.next;
    case 'play-mode':
      return language.value.startsWith('zh') ? translatePlayMode(playModeLabel(state.value.playMode)) : playModeLabel(state.value.playMode);
    default:
      return isPlaying.value ? text.value.pause : text.value.play;
  }
});
const viewClasses = computed(() => [
  `view-${settings.value.viewKind}`,
  `layout-${layout.value}`,
  {
    disconnected: !state.value.connected,
    playing: isPlaying.value
  }
]);
const primaryLyricStyle = computed(() => getLyricTextStyle({
  align: settings.value.primaryAlign,
  x: settings.value.primaryX,
  y: settings.value.primaryY,
  color: settings.value.primaryColor,
  fontSize: settings.value.primaryFontSize
}));
const secondaryLyricStyle = computed(() => getLyricTextStyle({
  align: settings.value.secondaryAlign,
  x: settings.value.secondaryX,
  y: settings.value.secondaryY,
  color: settings.value.secondaryColor,
  fontSize: settings.value.secondaryFontSize
}));

watch(isReady, (ready) => {
  if (!ready) return;
  startLoops();
  void refresh();
}, { immediate: true });

watch(unitData, () => {
  void nextTick(() => bridge.value?.notifyViewReady());
}, { deep: true });

watch(coverSrc, (source) => {
  if (source) reportCoverDiagnostic('cover-src-ready');
}, { immediate: true });

onMounted(() => {
  resizeObserver = new ResizeObserver((entries) => {
    const rect = entries[0]?.contentRect;
    if (!rect) return;
    viewport.value = { width: rect.width, height: rect.height };
  });
  if (rootEl.value) resizeObserver.observe(rootEl.value);
});

onUnmounted(() => {
  resizeObserver?.disconnect();
  resizeObserver = null;
  stopLoops();
});

function startLoops() {
  stopLoops();
  pollTimer = setInterval(() => { void refresh(); }, 800);
  animationTimer = setInterval(() => {
    animationNow.value = Date.now();
    bridge.value?.notifyViewReady();
  }, 120);
}

function stopLoops() {
  if (pollTimer) clearInterval(pollTimer);
  if (animationTimer) clearInterval(animationTimer);
  pollTimer = null;
  animationTimer = null;
}

async function refresh() {
  if (!isReady.value) return;
  try {
    const next = await backendRpc<PlaybackState>('getPlaybackState');
    const nextCursor = `${next.currentLyric?.lineIndex ?? -1}:${next.currentLyric?.wordIndex ?? -1}`;
    if (nextCursor !== lyricCursor.value) {
      lyricCursor.value = nextCursor;
      lyricCursorStartedAt.value = Date.now();
    }
    state.value = next;
    errorMessage.value = '';
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : String(error);
  }
  await nextTick();
  bridge.value?.notifyViewReady();
}

async function sendCommand(command: PlayerCommand) {
  const result = await backendRpc<{ success: boolean; error?: string }>('sendPlayerCommand', [command]).catch((error) => ({
    success: false,
    error: error instanceof Error ? error.message : String(error)
  }));
  if (!result.success) errorMessage.value = result.error ?? text.value.commandFailed;
  window.setTimeout(() => { void refresh(); }, 120);
}

function commandForView(): PlayerCommand {
  switch (settings.value.viewKind) {
    case 'previous':
      return 'previous';
    case 'next':
      return 'next';
    case 'play-mode':
      return 'togglePlayMode';
    default:
      return 'togglePlayPause';
  }
}

function coverSourceKind(source: string): string {
  if (!source) return 'empty';
  if (source.startsWith('data:')) return 'data-url';
  if (/^https?:\/\//i.test(source)) return 'http-url';
  if (/^orpheus:\/\//i.test(source)) return 'orpheus-url';
  return 'other';
}

function reportCoverDiagnostic(event: string, error?: string) {
  const source = coverSrc.value;
  const key = `${event}:${state.value.song?.songName ?? ''}:${source.slice(0, 96)}:${error ?? ''}`;
  if (reportedCoverDiagnostics.has(key)) return;
  reportedCoverDiagnostics.add(key);

  void backendRpc('reportUnitViewDiagnostic', [{
    event,
    viewKind: settings.value.viewKind,
    songName: state.value.song?.songName ?? null,
    coverSourceKind: coverSourceKind(source),
    coverSourceLength: source.length,
    coverPreview: source.startsWith('data:') ? source.slice(0, 48) : source.slice(0, 120),
    error
  }]).catch(() => undefined);
}

function handleCoverLoad() {
  reportCoverDiagnostic('cover-load');
}

function handleCoverError() {
  errorMessage.value = text.value.coverFailed;
  reportCoverDiagnostic('cover-error', 'HTMLImageElement error event');
}

function translatePlayMode(label: string): string {
  return text.value.playModes[label] ?? label;
}

const enText = {
  ready: 'Ready',
  waiting: 'Waiting for FlexLink',
  noLyrics: 'No lyrics',
  play: 'Play',
  pause: 'Pause',
  previous: 'Previous',
  next: 'Next',
  commandFailed: 'Command failed',
  coverFailed: 'Cover image failed to load',
  playModes: {} as Record<string, string>
};

const zhText = {
  ready: '就绪',
  waiting: '等待 FlexLink',
  noLyrics: '暂无歌词',
  play: '播放',
  pause: '暂停',
  previous: '上一�?,
  next: '下一�?,
  commandFailed: '命令执行失败',
  coverFailed: '封面加载失败',
  playModes: {
    Sequential: '顺序播放',
    'List Loop': '列表循环',
    'Single Loop': '单曲循环',
    Shuffle: '随机播放'
  } as Record<string, string>
};
</script>

<template>
  <div ref="rootEl" class="device-view" :class="viewClasses">
    <section v-if="settings.viewKind === 'now-playing'" class="now-playing">
      <div class="album-art">
        <img
          v-if="coverSrc"
          :key="coverSrc"
          :src="coverSrc"
          alt=""
          referrerpolicy="no-referrer"
          @load="handleCoverLoad"
          @error="handleCoverError"
        />
        <i v-else class="mdi mdi-music-note" aria-hidden="true"></i>
        <span v-if="!isPlaying" class="pause-mask">
          <i class="mdi mdi-pause" aria-hidden="true"></i>
        </span>
      </div>

      <div class="track-body">
        <div class="track-header">
          <strong v-if="settings.showTitle !== false" class="track-title">
            {{ state.song?.songName || 'Netease Music' }}
          </strong>
        </div>
        <div v-if="settings.showArtist !== false" class="artist-name">
          {{ state.song?.authorName || (state.connected ? text.ready : text.waiting) }}
        </div>
        <div v-if="settings.showAlbum !== false && state.song?.albumName" class="album-name">
          {{ state.song.albumName }}
        </div>
        <div v-if="settings.showProgress !== false" class="progress-wrap">
          <div class="time-row">
            <span>{{ formatTime(displayedCurrentTime) }}</span>
            <span>{{ formatTime(state.timeline.totalTime) }}</span>
          </div>
          <div class="progress-track">
            <span class="progress-fill" :style="{ width: `${progressPercent}%` }"></span>
          </div>
        </div>
      </div>
    </section>

    <section v-else-if="settings.viewKind === 'lyrics'" class="lyrics-view" :style="{ backgroundColor: settings.backgroundColor }">
      <div class="lyrics-shade" />
      <div v-if="settings.primaryEnabled !== false" class="lyric-primary" :style="primaryLyricStyle">
        <template v-if="lyricSegments.length">
          <span
            v-for="(segment, index) in lyricSegments"
            :key="index"
            :class="segment.className"
            :style="segment.className === 'active' ? { color: settings.highlightColor } : undefined"
          >
            <template v-if="segment.chars.length">
              <span
                v-for="(char, charIndex) in segment.chars"
                :key="charIndex"
                :style="{ color: char.highlighted ? settings.highlightColor : settings.primaryColor }"
              >{{ char.text }}</span>
            </template>
            <template v-else>{{ segment.text }}</template>
          </span>
        </template>
        <span v-else>{{ state.connected ? text.noLyrics : text.waiting }}</span>
      </div>
      <div
        v-if="secondaryLyric"
        class="lyric-secondary"
        :style="secondaryLyricStyle"
      >
        {{ secondaryLyric }}
      </div>
    </section>

    <button v-else class="control-view" type="button" @click="sendCommand(commandForView())">
      <span class="control-face">
        <i class="mdi control-icon" :class="controlIcon" aria-hidden="true"></i>
      </span>
      <span v-if="settings.compactLabel !== false" class="control-label">{{ controlLabel }}</span>
    </button>

    <div v-if="errorMessage" class="status-overlay">{{ errorMessage }}</div>
  </div>
</template>

<style scoped>
.device-view {
  --device-surface: rgb(var(--v-theme-surface));
  --device-on-surface: rgb(var(--v-theme-on-surface));
  --device-muted: rgba(var(--v-theme-on-surface), 0.62);
  --device-border: rgba(var(--v-theme-on-surface), 0.08);
  --device-primary: #e60026;
  width: 100%;
  height: 100vh;
  min-height: 48px;
  overflow: hidden;
  position: relative;
  color: var(--device-on-surface);
  background: var(--device-surface);
  font-family: "Microsoft YaHei", "Segoe UI", Arial, sans-serif;
}

.now-playing {
  display: grid;
  width: 100%;
  height: 100%;
  background:
    linear-gradient(180deg, rgba(var(--v-theme-on-surface), 0.045), transparent 42%),
    var(--device-surface);
}

.layout-wide .now-playing,
.layout-compact .now-playing {
  grid-template-columns: auto minmax(0, 1fr);
}

.layout-stacked .now-playing {
  grid-template-rows: minmax(0, 1fr) auto;
}

.album-art {
  position: relative;
  display: grid;
  place-items: center;
  overflow: hidden;
  color: var(--device-primary);
  background: rgba(var(--v-theme-on-surface), 0.075);
}

.layout-wide .album-art,
.layout-compact .album-art {
  height: 100%;
  aspect-ratio: 1;
}

.layout-stacked .album-art {
  width: 100%;
  min-height: 0;
}

.album-art img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.album-art > .mdi {
  font-size: 30px;
}

.pause-mask {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  color: white;
  background: rgba(0, 0, 0, 0.48);
  font-size: 24px;
}

.track-body {
  min-width: 0;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 4px;
  padding: 8px 10px;
}

.layout-stacked .track-body {
  padding: 8px;
}

.layout-compact .track-body {
  gap: 2px;
  padding: 4px 6px;
}

.track-header {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.track-title,
.album-name,
.artist-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.track-title {
  min-width: 0;
  font-size: 16px;
  line-height: 1.15;
  font-weight: 700;
}

.layout-compact .track-title {
  font-size: 13px;
}

.artist-name,
.album-name,
.time-row {
  color: var(--device-muted);
  font-size: 11px;
  line-height: 1.2;
}

.layout-compact .album-name,
.layout-compact .time-row {
  display: none;
}

.progress-wrap {
  display: grid;
  gap: 3px;
  margin-top: 2px;
}

.time-row {
  display: flex;
  justify-content: space-between;
}

.progress-track {
  height: 4px;
  overflow: hidden;
  background: rgba(var(--v-theme-on-surface), 0.12);
}

.progress-fill {
  display: block;
  height: 100%;
  background: var(--device-primary);
}

.lyrics-view {
  width: 100%;
  height: 100%;
  overflow: hidden;
  position: relative;
}

.lyrics-shade {
  position: absolute;
  inset: 0;
  background:
    linear-gradient(180deg, transparent 0%, rgba(0, 0, 0, 0.12) 100%),
    linear-gradient(90deg, transparent 0%, rgba(0, 0, 0, 0.08) 100%);
  pointer-events: none;
}

.lyric-primary,
.lyric-secondary {
  position: absolute;
  left: 0;
  right: 0;
  box-sizing: border-box;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  line-height: 1.2;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.28);
}

.lyric-primary {
  font-weight: 760;
}

.lyric-secondary {
  line-height: 1.15;
  opacity: 0.86;
}

.control-view {
  width: 100%;
  height: 100%;
  border: 0;
  padding: 0;
  display: grid;
  place-items: center;
  align-content: center;
  gap: 4px;
  color: var(--device-on-surface);
  background:
    linear-gradient(180deg, rgba(var(--v-theme-on-surface), 0.04), transparent),
    var(--device-surface);
  cursor: pointer;
}

.control-face {
  display: grid;
  place-items: center;
  width: min(56px, 72%);
  aspect-ratio: 1;
  border: 1px solid rgba(var(--netease-red-rgb), 0.18);
  border-radius: 999px;
  color: var(--device-primary);
  background: rgba(var(--netease-red-rgb), 0.12);
}

.control-icon {
  font-size: 30px;
  line-height: 1;
}

.control-label {
  max-width: 90%;
  overflow: hidden;
  color: var(--device-muted);
  font-size: 11px;
  line-height: 1;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.status-overlay {
  position: absolute;
  inset-inline: 6px;
  bottom: 4px;
  padding: 2px 6px;
  background: rgba(0, 0, 0, 0.72);
  color: #ffb4b4;
  font-size: 10px;
  line-height: 1.2;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.disconnected .progress-fill {
  width: 0 !important;
}

@media (max-height: 72px) {
  .control-face {
    width: min(42px, 64%);
  }

  .control-icon {
    font-size: 24px;
  }

  .control-label,
  .artist-name {
    font-size: 10px;
  }
}
</style>
