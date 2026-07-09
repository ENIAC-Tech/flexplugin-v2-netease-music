<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useFlexBridge } from '@flexsdk/runtime/vue';
import { getSetupStepState, type UiStatus } from './unit-view-model';

type Status = UiStatus;

interface RpcResult {
  success: boolean;
  error?: string;
  targetPath?: string;
}

interface SetupStep {
  id: string;
  title: string;
  body: string;
  action: string;
  icon: string;
  status: Status;
  actionKind: 'url' | 'install' | 'test';
  url?: string;
}

const { isReady, backendRpc, showSnackbarMessage, language } = useFlexBridge();
const installStatus = ref<Status>('idle');
const connectionStatus = ref<Status>('idle');
const installMessage = ref('');
const connectionMessage = ref('');
const currentSong = ref('');
const lastCheckedAt = ref('');

const text = computed(() => language.value.startsWith('zh') ? zhText : enText);
const connectionMeta = computed(() => getSetupStepState(connectionStatus.value));
const statusChipText = computed(() => {
  if (connectionStatus.value === 'success') return text.value.connectedChip;
  if (connectionStatus.value === 'loading') return text.value.checkingChip;
  if (connectionStatus.value === 'error') return text.value.actionNeededChip;
  return text.value.notCheckedChip;
});

const setupSteps = computed<SetupStep[]>(() => [
  {
    id: 'netease',
    title: text.value.step1Title,
    body: text.value.step1Body,
    action: text.value.step1Action,
    icon: 'mdi-music-note',
    status: 'idle',
    actionKind: 'url',
    url: 'https://music.163.com/st/download'
  },
  {
    id: 'betterncm',
    title: text.value.step2Title,
    body: text.value.step2Body,
    action: text.value.step2Action,
    icon: 'mdi-puzzle',
    status: 'idle',
    actionKind: 'url',
    url: 'https://microblock.cc/betterncm'
  },
  {
    id: 'flexlink',
    title: text.value.step3Title,
    body: installMessage.value || text.value.step3Body,
    action: text.value.step3Action,
    icon: 'mdi-link-variant',
    status: installStatus.value,
    actionKind: 'install'
  },
  {
    id: 'connection',
    title: text.value.step4Title,
    body: connectionMessage.value || text.value.step4Body,
    action: text.value.step4Action,
    icon: 'mdi-connection',
    status: connectionStatus.value,
    actionKind: 'test'
  }
]);

const diagnostics = computed(() => [
  { label: text.value.runtimeLabel, value: isReady.value ? text.value.ready : text.value.waiting },
  { label: text.value.dependencyLabel, value: text.value.dependencyValue },
  { label: text.value.endpointLabel, value: 'ws://127.0.0.1:35010' },
  { label: text.value.currentSongLabel, value: currentSong.value || text.value.noSong },
  { label: text.value.lastCheckedLabel, value: lastCheckedAt.value || text.value.notChecked }
]);

watch(isReady, (ready) => {
  if (ready) void testConnection(false);
}, { immediate: true });

async function openUrl(url: string) {
  const result = await backendRpc<RpcResult>('openExternalUrl', [url]).catch((error) => ({
    success: false,
    error: error instanceof Error ? error.message : String(error)
  }));
  if (!result.success) {
    await showSnackbarMessage({ message: result.error ?? text.value.openFailed, type: 'error' });
  }
}

async function installFlexLink() {
  installStatus.value = 'loading';
  installMessage.value = '';
  const result = await backendRpc<RpcResult>('installFlexLinkPlugin').catch((error) => ({
    success: false,
    error: error instanceof Error ? error.message : String(error)
  }));
  if (result.success) {
    installStatus.value = 'success';
    installMessage.value = result.targetPath ? `${text.value.installedTo} ${result.targetPath}` : text.value.installSuccess;
    await showSnackbarMessage({ message: text.value.installSuccess, type: 'success' });
    return;
  }
  installStatus.value = 'error';
  installMessage.value = result.error ?? text.value.installFailed;
  await showSnackbarMessage({ message: installMessage.value, type: 'error' });
}

async function testConnection(showToast = true) {
  connectionStatus.value = 'loading';
  const result = await backendRpc<{ connected: boolean; currentSong?: string | null; error?: string | null }>('getConnectionStatus').catch((error) => ({
    connected: false,
    error: error instanceof Error ? error.message : String(error)
  }));

  lastCheckedAt.value = new Date().toLocaleTimeString();
  currentSong.value = result.currentSong ?? '';
  if (result.connected) {
    connectionStatus.value = 'success';
    connectionMessage.value = result.currentSong ? `${text.value.connected}: ${result.currentSong}` : text.value.connected;
    if (showToast) await showSnackbarMessage({ message: text.value.connected, type: 'success' });
    return;
  }

  connectionStatus.value = 'error';
  connectionMessage.value = result.error || text.value.notConnected;
  if (showToast) await showSnackbarMessage({ message: text.value.notConnected, type: 'warning' });
}

async function handleStepAction(step: SetupStep) {
  if (step.actionKind === 'url' && step.url) {
    await openUrl(step.url);
    return;
  }
  if (step.actionKind === 'install') {
    await installFlexLink();
    return;
  }
  await testConnection(true);
}

function isStepDisabled(step: SetupStep): boolean {
  if (step.actionKind === 'url') return false;
  return !isReady.value || step.status === 'loading';
}

function stateLabel(status: Status): string {
  return text.value.statusLabels[getSetupStepState(status).labelKey];
}

const enText = {
  title: 'NeteaseMusic',
  subtitle: 'Windows desktop integration through BetterNCM FlexLink.',
  setupTitle: 'Setup flow',
  diagnosticsTitle: 'Diagnostics',
  refresh: 'Refresh connection',
  connectedChip: 'Connected',
  checkingChip: 'Checking',
  actionNeededChip: 'Action needed',
  notCheckedChip: 'Not checked',
  step1Title: 'Netease Cloud Music',
  step1Body: 'Install the Windows desktop client and launch it once.',
  step1Action: 'Download',
  step2Title: 'BetterNCM',
  step2Body: 'Install BetterNCM, restart Netease Cloud Music, then open the plugin manager.',
  step2Action: 'Open site',
  step3Title: 'FlexLink.plugin',
  step3Body: 'Copy the bundled FlexLink.plugin into C:\\betterncm\\plugins, then restart Netease Cloud Music.',
  step3Action: 'Install',
  step4Title: 'Connection',
  step4Body: 'Keep Netease Cloud Music running and verify FlexLink on the local WebSocket endpoint.',
  step4Action: 'Test',
  connected: 'Connected',
  notConnected: 'Not connected. Check NeteaseMusicLinkEssentials, Netease Cloud Music, BetterNCM, and FlexLink.',
  installSuccess: 'FlexLink.plugin installed.',
  installFailed: 'Install failed.',
  installedTo: 'Installed to',
  openFailed: 'Failed to open link.',
  runtimeLabel: 'Frontend bridge',
  dependencyLabel: 'Dependency plugin',
  dependencyValue: 'NeteaseMusicLinkEssentials',
  endpointLabel: 'FlexLink endpoint',
  currentSongLabel: 'Now playing',
  lastCheckedLabel: 'Last check',
  noSong: 'No active track',
  ready: 'Ready',
  waiting: 'Waiting',
  notChecked: 'Not checked',
  statusLabels: {
    manual: 'Manual',
    working: 'Working',
    ready: 'Ready',
    needsAction: 'Needs action'
  }
};

const zhText = {
  title: '网易云音�?,
  subtitle: '通过 BetterNCM FlexLink 连接 Windows 桌面客户端�?,
  setupTitle: '安装流程',
  diagnosticsTitle: '诊断信息',
  refresh: '刷新连接',
  connectedChip: '已连�?,
  checkingChip: '检查中',
  actionNeededChip: '需要处�?,
  notCheckedChip: '未检�?,
  step1Title: '网易云音�?,
  step1Body: '安装 Windows 桌面客户端，并至少启动一次�?,
  step1Action: '下载',
  step2Title: 'BetterNCM',
  step2Body: '安装 BetterNCM，重启网易云音乐，然后确认插件管理器可用�?,
  step2Action: '打开站点',
  step3Title: 'FlexLink.plugin',
  step3Body: '将内�?FlexLink.plugin 复制�?C:\\betterncm\\plugins，完成后重启网易云音乐�?,
  step3Action: '安装',
  step4Title: '连接状�?,
  step4Body: '保持网易云音乐运行，并检查本�?WebSocket 端点是否可连接�?,
  step4Action: '测试',
  connected: '已连�?,
  notConnected: '未连接。请确认 NeteaseMusicLinkEssentials、网易云音乐、BetterNCM �?FlexLink 都在运行�?,
  installSuccess: 'FlexLink.plugin 已安装�?,
  installFailed: '安装失败�?,
  installedTo: '已安装到',
  openFailed: '打开链接失败�?,
  runtimeLabel: '前端桥接',
  dependencyLabel: '依赖插件',
  dependencyValue: 'NeteaseMusicLinkEssentials',
  endpointLabel: 'FlexLink 端点',
  currentSongLabel: '当前播放',
  lastCheckedLabel: '最近检�?,
  noSong: '暂无曲目',
  ready: '就绪',
  waiting: '等待�?,
  notChecked: '未检�?,
  statusLabels: {
    manual: '手动',
    working: '处理�?,
    ready: '就绪',
    needsAction: '需处理'
  }
};
</script>

<template>
  <v-app class="flex-plugin-app">
    <v-main>
      <v-container class="pa-4 plugin-page">
        <header class="plugin-titlebar">
          <div class="plugin-title-icon netease-accent">
            <v-icon size="22">mdi-music-circle</v-icon>
          </div>
          <div class="plugin-title-stack">
            <h1>{{ text.title }}</h1>
            <p>{{ text.subtitle }}</p>
          </div>
          <div class="plugin-toolbar-actions">
            <v-chip
              size="small"
              variant="tonal"
              :color="connectionMeta.color === 'default' ? undefined : connectionMeta.color"
            >
              {{ statusChipText }}
            </v-chip>
            <v-tooltip :text="text.refresh" location="bottom">
              <template #activator="{ props }">
                  <v-btn
                    v-bind="props"
                    icon="mdi-refresh"
                    variant="tonal"
                    size="small"
                  :loading="connectionStatus === 'loading'"
                  :disabled="!isReady || connectionStatus === 'loading'"
                  @click="testConnection(true)"
                />
              </template>
            </v-tooltip>
          </div>
        </header>

        <div class="plugin-grid two">
          <section class="plugin-panel">
            <div class="plugin-panel-header">
              <div class="plugin-panel-title">
                <v-icon size="18">mdi-format-list-checks</v-icon>
                <span>{{ text.setupTitle }}</span>
              </div>
            </div>

            <div class="plugin-step-list">
              <article v-for="step in setupSteps" :key="step.id" class="plugin-step-row">
                <v-icon
                  :icon="step.status === 'idle' ? step.icon : getSetupStepState(step.status).icon"
                  :color="getSetupStepState(step.status).color === 'default' ? undefined : getSetupStepState(step.status).color"
                  :class="{ 'plugin-spin': step.status === 'loading' }"
                  size="22"
                />
                <div class="plugin-step-copy">
                  <div class="plugin-step-title">
                    {{ step.title }}
                    <v-chip class="ml-2" size="x-small" variant="tonal">
                      {{ stateLabel(step.status) }}
                    </v-chip>
                  </div>
                  <div class="plugin-step-body">{{ step.body }}</div>
                </div>
                <div class="plugin-step-action">
                  <v-btn
                    size="small"
                    variant="tonal"
                    color="#e60026"
                    :disabled="isStepDisabled(step)"
                    :loading="step.status === 'loading'"
                    @click="handleStepAction(step)"
                  >
                    {{ step.action }}
                  </v-btn>
                </div>
              </article>
            </div>
          </section>

          <section class="plugin-panel">
            <div class="plugin-panel-header">
              <div class="plugin-panel-title">
                <v-icon size="18">mdi-stethoscope</v-icon>
                <span>{{ text.diagnosticsTitle }}</span>
              </div>
            </div>
            <div class="plugin-row-list">
              <div v-for="item in diagnostics" :key="item.label" class="plugin-data-row">
                <v-icon size="18" color="medium-emphasis">mdi-circle-small</v-icon>
                <div class="plugin-data-copy">
                  <div class="plugin-data-title">{{ item.label }}</div>
                  <div class="plugin-data-value">{{ item.value }}</div>
                </div>
              </div>
            </div>
          </section>
        </div>
      </v-container>
    </v-main>
  </v-app>
</template>
