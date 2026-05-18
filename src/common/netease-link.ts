export const NETEASE_LINK_PLUGIN_UUID = '@aspen/netease-music-link-essentials';

export const NETEASE_LINK_METHODS = {
  getApiInfo: 'getApiInfo',
  getPlaybackState: 'getPlaybackState',
  getConnectionStatus: 'getConnectionStatus',
  sendPlayerCommand: 'sendPlayerCommand',
  installFlexLinkPlugin: 'installFlexLinkPlugin',
  openExternalUrl: 'openExternalUrl',
  reportDiagnostic: 'reportDiagnostic'
} as const;

export interface NeteaseLinkConnectionStatus {
  connected: boolean;
  currentSong: string | null;
  lastUpdatedAt: number;
  error: string | null;
  webSocketUrl?: string;
}

export interface NeteaseLinkRpcResult {
  success: boolean;
  error?: string;
  targetPath?: string;
}
