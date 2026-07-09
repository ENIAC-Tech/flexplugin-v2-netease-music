<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useFlexBridge } from '@flexsdk/runtime/vue';

const { isReady, bridge, language } = useFlexBridge();
const unitName = ref('');
const hostUnitName = ref('');
const isApplyingHostUpdate = ref(false);

let syncTimer: ReturnType<typeof window.setTimeout> | null = null;

const text = computed(() => language.value.startsWith('zh') ? zhText : enText);

watch(isReady, async (ready) => {
  if (!ready || !bridge.value) return;
  await loadUnit();
  bridge.value.onHostEvent('unit-updated', () => {
    void loadUnit();
  });
}, { immediate: true });

watch(unitName, () => {
  if (!isReady.value || isApplyingHostUpdate.value) return;
  queueSync();
});

async function loadUnit() {
  const unit = await bridge.value?.getUnit().catch(() => null);
  if (!unit) return;
  isApplyingHostUpdate.value = true;
  hostUnitName.value = unit.name ?? '';
  unitName.value = hostUnitName.value;
  window.setTimeout(() => {
    isApplyingHostUpdate.value = false;
  }, 0);
}

function queueSync() {
  if (syncTimer) window.clearTimeout(syncTimer);
  syncTimer = window.setTimeout(() => {
    void syncUnitName();
  }, 240);
}

async function syncUnitName() {
  if (!bridge.value) return;
  const nextName = unitName.value.trim();
  if (!nextName || nextName === hostUnitName.value) return;
  const unit = await bridge.value.getUnit().catch(() => null);
  if (!unit) return;
  await bridge.value.setUnit({ ...unit, name: nextName });
  hostUnitName.value = nextName;
}

const enText = {
  title: 'Appearance',
  subtitle: 'Changes sync automatically.',
  unitName: 'Unit name',
  defaultUnitName: 'NeteaseMusic',
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
  title: '外观',
  subtitle: '设置变更会自动同步�?,
  unitName: 'Unit 名称',
  defaultUnitName: '网易云音�?,
  unitNames: {
    'now-playing': '当前播放',
    lyrics: '歌词',
    'play-pause': '播放 / 暂停',
    previous: '上一�?,
    next: '下一�?,
    'play-mode': '播放模式'
  }
};
</script>

<template>
  <v-app class="flex-plugin-app">
    <v-main>
      <v-container class="pa-4 plugin-page appearance-editor">
        <v-text-field
          v-model="unitName"
          :label="text.unitName"
          density="compact"
          variant="solo-filled"
          hide-details
          :disabled="!isReady"
        />
      </v-container>
    </v-main>
  </v-app>
</template>

<style scoped>
.appearance-editor {
  max-width: 560px;
}
</style>
