<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useFlexBridge } from '@flexsdk/runtime/vue';
import { normalizeUnitSettings, type AlignOption, type UnitSettings } from '../common/netease';
import PluginColorPickerField from './PluginColorPickerField.vue';
import { getLyricPositionLimits, getUnitPixelSize, type UnitPixelSize } from './unit-view-model';

interface LyricSectionConfig {
  enabledKey: 'primaryEnabled' | 'secondaryEnabled';
  xKey: 'primaryX' | 'secondaryX';
  yKey: 'primaryY' | 'secondaryY';
  sizeKey: 'primaryFontSize' | 'secondaryFontSize';
  colorKey: 'primaryColor' | 'secondaryColor';
  alignKey: 'primaryAlign' | 'secondaryAlign';
  title: string;
}

const { isReady, setUnitData, typeId, unitData, language, bridge } = useFlexBridge();
const form = ref<UnitSettings>(normalizeUnitSettings(unitData.value, typeId.value));
const unitSize = ref<UnitPixelSize>({ width: 64, height: 64 });
const isApplyingHostUpdate = ref(false);

let syncTimer: ReturnType<typeof window.setTimeout> | null = null;

const text = computed(() => language.value.startsWith('zh') ? zhText : enText);
const viewKind = computed(() => form.value.viewKind);
const positionLimits = computed(() => getLyricPositionLimits(unitSize.value));
const alignOptions = computed(() => [
  { title: text.value.alignLeft, value: 'left' as AlignOption, icon: 'mdi-format-align-left' },
  { title: text.value.alignCenter, value: 'center' as AlignOption, icon: 'mdi-format-align-center' },
  { title: text.value.alignRight, value: 'right' as AlignOption, icon: 'mdi-format-align-right' }
]);
const lyricSections = computed<LyricSectionConfig[]>(() => [
  {
    title: text.value.primaryLyric,
    enabledKey: 'primaryEnabled',
    xKey: 'primaryX',
    yKey: 'primaryY',
    sizeKey: 'primaryFontSize',
    colorKey: 'primaryColor',
    alignKey: 'primaryAlign'
  },
  {
    title: text.value.secondaryLyric,
    enabledKey: 'secondaryEnabled',
    xKey: 'secondaryX',
    yKey: 'secondaryY',
    sizeKey: 'secondaryFontSize',
    colorKey: 'secondaryColor',
    alignKey: 'secondaryAlign'
  }
]);

watch([unitData, typeId], () => {
  isApplyingHostUpdate.value = true;
  form.value = normalizeUnitSettings(unitData.value, typeId.value);
  if (isReady.value) void refreshUnitSize();
  window.setTimeout(() => {
    isApplyingHostUpdate.value = false;
  }, 0);
}, { immediate: true, deep: true });

watch(isReady, (ready) => {
  if (!ready) return;
  void refreshUnitSize();
}, { immediate: true });

watch(positionLimits, () => {
  clampLyricPositions();
}, { immediate: true });

watch(form, () => {
  if (!isReady.value || isApplyingHostUpdate.value) return;
  queueSync();
}, { deep: true });

async function refreshUnitSize() {
  const unit = await bridge.value?.getUnit().catch(() => null);
  unitSize.value = getUnitPixelSize(unit);
}

function queueSync() {
  if (syncTimer) window.clearTimeout(syncTimer);
  syncTimer = window.setTimeout(() => {
    void setUnitData({ ...unitData.value, ...form.value });
  }, 180);
}

function getNumber(key: keyof UnitSettings, fallback: number): number {
  const value = form.value[key];
  return typeof value === 'number' ? value : fallback;
}

function setNumber(key: keyof UnitSettings, value: number) {
  (form.value as Record<string, unknown>)[key] = value;
}

function clampLyricPositions() {
  const limits = positionLimits.value;
  clampNumber('primaryX', limits.x);
  clampNumber('secondaryX', limits.x);
  clampNumber('primaryY', limits.y);
  clampNumber('secondaryY', limits.y);
}

function clampNumber(key: keyof UnitSettings, max: number) {
  const value = form.value[key];
  if (typeof value !== 'number') return;
  const next = Math.max(0, Math.min(max, value));
  if (next !== value) setNumber(key, next);
}

function getBoolean(key: keyof UnitSettings, fallback: boolean): boolean {
  const value = form.value[key];
  return typeof value === 'boolean' ? value : fallback;
}

function setBoolean(key: keyof UnitSettings, value: boolean) {
  (form.value as Record<string, unknown>)[key] = value;
}

function getString(key: keyof UnitSettings, fallback: string): string {
  const value = form.value[key];
  return typeof value === 'string' ? value : fallback;
}

function setString(key: keyof UnitSettings, value: string) {
  (form.value as Record<string, unknown>)[key] = value;
}

function getAlign(key: keyof UnitSettings): AlignOption {
  const value = form.value[key];
  return value === 'left' || value === 'center' || value === 'right' ? value : 'right';
}

function setAlign(key: keyof UnitSettings, value: AlignOption) {
  (form.value as Record<string, unknown>)[key] = value;
}

const enText = {
  title: 'Unit behavior',
  subtitle: 'Changes sync automatically.',
  nowPlaying: 'Now Playing',
  lyrics: 'Lyrics',
  controls: 'Control Button',
  primaryLyric: 'Main lyric',
  secondaryLyric: 'Secondary lyric',
  common: 'Common',
  defaultUnitName: 'NeteaseMusic',
  enabled: 'Enabled',
  x: 'X position',
  y: 'Y position',
  size: 'Size',
  color: 'Color',
  align: 'Alignment',
  alignLeft: 'Left',
  alignCenter: 'Center',
  alignRight: 'Right',
  highlightColor: 'Highlight color',
  showTitle: 'Track title',
  showArtist: 'Artist',
  showAlbum: 'Album',
  showProgress: 'Progress',
  compactLabel: 'Compact label',
  unitNames: {
    'now-playing': 'Now Playing',
    lyrics: 'Lyrics',
    'play-pause': 'Play / Pause',
    previous: 'Previous',
    next: 'Next',
    'play-mode': 'Play Mode'
  }
};

const zhText = {
  title: 'Unit 功能',
  subtitle: '设置变更会自动同步。',
  nowPlaying: '当前播放',
  lyrics: '歌词',
  controls: '控制按键',
  primaryLyric: '主歌词',
  secondaryLyric: '副歌词',
  common: '通用',
  defaultUnitName: '网易云音乐',
  enabled: '启用',
  x: 'X 位置',
  y: 'Y 位置',
  size: '大小',
  color: '颜色',
  align: '对齐方式',
  alignLeft: '左对齐',
  alignCenter: '居中',
  alignRight: '右对齐',
  highlightColor: '高亮颜色',
  showTitle: '歌曲标题',
  showArtist: '艺人',
  showAlbum: '专辑',
  showProgress: '进度',
  compactLabel: '紧凑标签',
  unitNames: {
    'now-playing': '当前播放',
    lyrics: '歌词',
    'play-pause': '播放 / 暂停',
    previous: '上一首',
    next: '下一首',
    'play-mode': '播放模式'
  }
};
</script>

<template>
  <v-app class="flex-plugin-app">
    <v-main>
      <v-container class="pa-4 plugin-page function-editor">
        <template v-if="viewKind === 'now-playing'">
          <div class="now-playing-switch-row">
            <v-switch v-model="form.showTitle" class="mini-switch" color="#e60026" density="compact" hide-details :label="text.showTitle" />
            <v-switch v-model="form.showArtist" class="mini-switch" color="#e60026" density="compact" hide-details :label="text.showArtist" />
            <v-switch v-model="form.showAlbum" class="mini-switch" color="#e60026" density="compact" hide-details :label="text.showAlbum" />
            <v-switch v-model="form.showProgress" class="mini-switch" color="#e60026" density="compact" hide-details :label="text.showProgress" />
          </div>
        </template>

        <template v-else-if="viewKind === 'lyrics'">
          <PluginColorPickerField
            :label="text.highlightColor"
            :model-value="form.highlightColor"
            @update:model-value="form.highlightColor = $event"
          />

          <div v-for="section in lyricSections" :key="section.title" class="lyric-section">
            <div class="lyric-section-title">
              <span>{{ section.title }}</span>
              <v-checkbox
                :model-value="getBoolean(section.enabledKey, true)"
                color="#e60026"
                density="compact"
                hide-details
                :aria-label="text.enabled"
                @update:model-value="setBoolean(section.enabledKey, Boolean($event))"
              />
            </div>
            <div class="lyric-control-grid">
              <v-slider
                :model-value="getNumber(section.xKey, 10)"
                :label="text.x"
                min="0"
                :max="positionLimits.x"
                step="1"
                thumb-label
                density="compact"
                hide-details
                @update:model-value="setNumber(section.xKey, Number($event))"
              />
              <v-slider
                :model-value="getNumber(section.yKey, section.yKey === 'primaryY' ? 8 : 32)"
                :label="text.y"
                min="0"
                :max="positionLimits.y"
                step="1"
                thumb-label
                density="compact"
                hide-details
                @update:model-value="setNumber(section.yKey, Number($event))"
              />
            </div>
            <div class="lyric-style-grid">
              <v-slider
                :model-value="getNumber(section.sizeKey, section.sizeKey === 'primaryFontSize' ? 18 : 13)"
                :label="text.size"
                min="8"
                max="36"
                step="1"
                thumb-label
                density="compact"
                hide-details
                @update:model-value="setNumber(section.sizeKey, Number($event))"
              />
              <div class="alignment-field">
                <v-label class="text-body-2">{{ text.align }}</v-label>
                <v-btn-toggle
                  :model-value="getAlign(section.alignKey)"
                  density="compact"
                  mandatory
                  variant="tonal"
                  divided
                  @update:model-value="setAlign(section.alignKey, $event as AlignOption)"
                >
                  <v-btn
                    v-for="option in alignOptions"
                    :key="option.value"
                    :value="option.value"
                    size="small"
                    variant="tonal"
                    :icon="option.icon"
                  />
                </v-btn-toggle>
              </div>
              <PluginColorPickerField
                :label="text.color"
                :model-value="getString(section.colorKey, '#ffffff')"
                @update:model-value="setString(section.colorKey, $event)"
              />
            </div>
          </div>
        </template>

        <template v-else>
          <div class="plugin-form-grid">
            <v-switch v-model="form.compactLabel" color="#e60026" density="compact" hide-details inset :label="text.compactLabel" />
          </div>
        </template>
      </v-container>
    </v-main>
  </v-app>
</template>

<style scoped>
.function-editor {
  max-width: 760px;
  display: grid;
  gap: 14px;
}

.lyric-section {
  display: grid;
  gap: 10px;
  padding-top: 2px;
}

.lyric-section-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  min-height: 30px;
  color: rgba(var(--v-theme-on-surface), 0.78);
  font-size: 12px;
  font-weight: 650;
  text-transform: uppercase;
}

.lyric-section-title :deep(.v-checkbox) {
  flex: 0 0 auto;
}

.lyric-section-title :deep(.v-selection-control) {
  min-height: 28px;
}

.lyric-control-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.now-playing-switch-row {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  align-items: center;
  gap: 8px;
}

.mini-switch {
  min-width: 0;
}

.mini-switch :deep(.v-selection-control) {
  min-height: 28px;
}

.mini-switch :deep(.v-label) {
  font-size: 12px;
  line-height: 16px;
  opacity: 0.82;
}

.mini-switch :deep(.v-switch__track) {
  width: 28px;
  height: 16px;
}

.mini-switch :deep(.v-switch__thumb) {
  width: 12px;
  height: 12px;
}

.lyric-style-grid {
  display: grid;
  grid-template-columns: minmax(120px, 1fr) auto auto;
  align-items: center;
  gap: 10px;
}

.alignment-field {
  display: grid;
  grid-template-columns: auto auto;
  align-items: center;
  gap: 8px;
  min-height: 40px;
}

@media (max-width: 720px) {
  .lyric-style-grid {
    grid-template-columns: minmax(90px, 1fr) auto auto;
  }

  .alignment-field {
    grid-template-columns: auto auto;
    justify-content: start;
  }
}
</style>
