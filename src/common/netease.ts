export const PLUGIN_UUID = '@aspen/netease-music';

export type ViewKind =
  | 'now-playing'
  | 'lyrics'
  | 'play-pause'
  | 'previous'
  | 'next'
  | 'play-mode';

export type PlayerCommand =
  | 'togglePlayPause'
  | 'play'
  | 'pause'
  | 'previous'
  | 'next'
  | 'togglePlayMode';

export type AlignOption = 'left' | 'center' | 'right';

export interface NeteaseSong {
  songName?: string;
  authorName?: string;
  albumName?: string;
  ncmId?: number;
  duration?: number;
  cover?: NeteaseCover | string | null;
  coverBase64?: string;
  coverMimeType?: string;
  originalCoverUrl?: string;
  coverUrl?: string;
  picUrl?: string;
  album?: {
    picUrl?: string;
    coverUrl?: string;
  };
}

export interface NeteaseCover {
  type?: 'Base64' | 'Url' | string;
  value?: string;
}

export interface TimelineState {
  currentTime: number;
  totalTime: number;
}

export interface PlayModeState {
  isShuffling: boolean;
  repeatMode: string;
}

export interface LyricLine {
  originalLyric?: string;
  translatedLyric?: string;
}

export interface CurrentLyricState {
  lineIndex?: number;
  wordIndex?: number;
  line?: LyricLine;
  nextLine?: LyricLine;
}

export interface LyricsState {
  lines?: LyricLine[];
  hasDynamicLyric?: boolean;
}

export interface PlaybackState {
  connected: boolean;
  song: NeteaseSong | null;
  playState: string;
  timeline: TimelineState;
  playMode: PlayModeState;
  lyrics: LyricsState | null;
  currentLyric: CurrentLyricState | null;
  lastUpdatedAt: number;
  connectionError: string | null;
}

export interface CompactPlaybackState {
  connected: boolean;
  connectionError: string | null;
  song: Pick<NeteaseSong, 'songName' | 'authorName' | 'albumName' | 'ncmId' | 'duration' | 'originalCoverUrl' | 'coverUrl' | 'picUrl'> & {
    album?: { picUrl?: string; coverUrl?: string };
  } | null;
  playState: string;
  timeline: TimelineState;
  playMode: PlayModeState;
  currentLyric: CurrentLyricState | null;
  lastUpdatedAt: number;
}

export interface UnitSettings {
  viewKind: ViewKind;
  showTitle?: boolean;
  showArtist?: boolean;
  showAlbum?: boolean;
  showProgress?: boolean;
  showTranslation?: boolean;
  highlightWord?: boolean;
  backgroundColor?: string;
  primaryEnabled?: boolean;
  primaryX?: number;
  primaryY?: number;
  primaryAlign?: AlignOption;
  primaryFontSize?: number;
  primaryColor?: string;
  highlightColor?: string;
  primaryPaddingTop?: number;
  secondaryEnabled?: boolean;
  secondaryX?: number;
  secondaryY?: number;
  secondaryAlign?: AlignOption;
  secondaryFontSize?: number;
  secondaryColor?: string;
  secondaryPaddingTop?: number;
  paddingHorizontal?: number;
  compactLabel?: boolean;
}

export type NeteasePluginUnitType = 'standard' | 'custom' | 'cycled';

export interface NeteaseAppearanceOverride {
  background?: Record<string, unknown>;
  elements?: Array<{
    identifier: string;
    data?: Record<string, unknown>;
    style?: Record<string, unknown>;
  }>;
}

export interface NeteaseCycledFunctionDefinition {
  functionId: string;
  name: string;
  data?: Record<string, unknown>;
  appearanceOverride?: NeteaseAppearanceOverride;
}

export const UNIT_DEFINITIONS: Array<{
  unitId: ViewKind;
  typeId: string;
  name: string;
  icon: string;
  pluginType: NeteasePluginUnitType;
  functions?: NeteaseCycledFunctionDefinition[];
  appearanceOverride?: NeteaseAppearanceOverride;
}> = [
  {
    unitId: 'now-playing',
    typeId: `${PLUGIN_UUID}.now-playing`,
    name: 'Now Playing',
    icon: 'mdi-music-box',
    pluginType: 'custom'
  },
  {
    unitId: 'lyrics',
    typeId: `${PLUGIN_UUID}.lyrics`,
    name: 'Lyrics',
    icon: 'mdi-text-short',
    pluginType: 'custom'
  },
  {
    unitId: 'play-pause',
    typeId: `${PLUGIN_UUID}.play-pause`,
    name: 'Play / Pause',
    icon: 'mdi-play-pause',
    pluginType: 'cycled',
    functions: [
      {
        functionId: 'play',
        name: 'Play',
        data: { command: 'play' },
        appearanceOverride: {
          background: { backgroundColor: '#1f7a4d' },
          elements: [
            { identifier: 'primary-icon', data: { value: 'mdi-play', type: 'icon' } },
            { identifier: 'primary-text', data: { text: 'Play' } }
          ]
        }
      },
      {
        functionId: 'pause',
        name: 'Pause',
        data: { command: 'pause' },
        appearanceOverride: {
          background: { backgroundColor: '#8f1730' },
          elements: [
            { identifier: 'primary-icon', data: { value: 'mdi-pause', type: 'icon' } },
            { identifier: 'primary-text', data: { text: 'Pause' } }
          ]
        }
      }
    ]
  },
  {
    unitId: 'previous',
    typeId: `${PLUGIN_UUID}.previous`,
    name: 'Previous',
    icon: 'mdi-skip-previous',
    pluginType: 'standard'
  },
  {
    unitId: 'next',
    typeId: `${PLUGIN_UUID}.next`,
    name: 'Next',
    icon: 'mdi-skip-next',
    pluginType: 'standard'
  },
  {
    unitId: 'play-mode',
    typeId: `${PLUGIN_UUID}.play-mode`,
    name: 'Play Mode',
    icon: 'mdi-repeat',
    pluginType: 'cycled',
    functions: [
      {
        functionId: 'sequential',
        name: 'Sequential',
        data: { command: 'togglePlayMode', mode: 'sequential' },
        appearanceOverride: {
          elements: [
            { identifier: 'primary-icon', data: { value: 'mdi-arrow-right', type: 'icon' } },
            { identifier: 'primary-text', data: { text: 'Sequential' } }
          ]
        }
      },
      {
        functionId: 'repeat-list',
        name: 'List Loop',
        data: { command: 'togglePlayMode', mode: 'repeat-list' },
        appearanceOverride: {
          elements: [
            { identifier: 'primary-icon', data: { value: 'mdi-repeat', type: 'icon' } },
            { identifier: 'primary-text', data: { text: 'List Loop' } }
          ]
        }
      },
      {
        functionId: 'repeat-one',
        name: 'Single Loop',
        data: { command: 'togglePlayMode', mode: 'repeat-one' },
        appearanceOverride: {
          elements: [
            { identifier: 'primary-icon', data: { value: 'mdi-repeat-once', type: 'icon' } },
            { identifier: 'primary-text', data: { text: 'Single Loop' } }
          ]
        }
      },
      {
        functionId: 'shuffle',
        name: 'Shuffle',
        data: { command: 'togglePlayMode', mode: 'shuffle' },
        appearanceOverride: {
          elements: [
            { identifier: 'primary-icon', data: { value: 'mdi-shuffle', type: 'icon' } },
            { identifier: 'primary-text', data: { text: 'Shuffle' } }
          ]
        }
      }
    ]
  }
];

export const DEFAULT_PLAYBACK_STATE: PlaybackState = {
  connected: false,
  song: null,
  playState: 'Stopped',
  timeline: { currentTime: 0, totalTime: 0 },
  playMode: { isShuffling: false, repeatMode: 'Off' },
  lyrics: null,
  currentLyric: null,
  lastUpdatedAt: 0,
  connectionError: null
};

export const DEFAULT_UNIT_SETTINGS: Record<ViewKind, UnitSettings> = {
  'now-playing': {
    viewKind: 'now-playing',
    showTitle: true,
    showArtist: true,
    showAlbum: true,
    showProgress: true
  },
  lyrics: {
    viewKind: 'lyrics',
    showTranslation: true,
    highlightWord: true,
    backgroundColor: '#141012',
    primaryEnabled: true,
    primaryX: 10,
    primaryY: 8,
    primaryAlign: 'right',
    primaryFontSize: 18,
    primaryColor: '#ffffff',
    highlightColor: '#e60026',
    primaryPaddingTop: 8,
    secondaryEnabled: true,
    secondaryX: 10,
    secondaryY: 32,
    secondaryAlign: 'right',
    secondaryFontSize: 13,
    secondaryColor: '#a8adb7',
    secondaryPaddingTop: 32,
    paddingHorizontal: 10
  },
  'play-pause': {
    viewKind: 'play-pause',
    compactLabel: true
  },
  previous: {
    viewKind: 'previous',
    compactLabel: true
  },
  next: {
    viewKind: 'next',
    compactLabel: true
  },
  'play-mode': {
    viewKind: 'play-mode',
    compactLabel: true
  }
};

export function createDefaultUnitData(viewKind: ViewKind): UnitSettings {
  return { ...DEFAULT_UNIT_SETTINGS[viewKind] };
}

export function getViewKindByTypeId(typeId: string, fallback: ViewKind = 'now-playing'): ViewKind {
  return UNIT_DEFINITIONS.find((unit) => unit.typeId === typeId)?.unitId ?? fallback;
}

export function normalizeUnitSettings(data: Record<string, any> | null | undefined, typeId = ''): UnitSettings {
  const viewKind = isViewKind(data?.viewKind) ? data.viewKind : getViewKindByTypeId(typeId);
  const normalized = {
    ...createDefaultUnitData(viewKind),
    ...(data ?? {}),
    viewKind
  };
  if (viewKind !== 'lyrics') return normalized;
  return {
    ...normalized,
    primaryEnabled: data?.primaryEnabled ?? true,
    primaryX: data?.primaryX ?? data?.paddingHorizontal ?? normalized.primaryX ?? 10,
    primaryY: data?.primaryY ?? data?.primaryPaddingTop ?? normalized.primaryY ?? 8,
    secondaryEnabled: data?.secondaryEnabled ?? data?.showTranslation ?? normalized.secondaryEnabled ?? true,
    secondaryX: data?.secondaryX ?? data?.paddingHorizontal ?? normalized.secondaryX ?? 10,
    secondaryY: data?.secondaryY ?? data?.secondaryPaddingTop ?? normalized.secondaryY ?? 32
  };
}

export function isViewKind(value: unknown): value is ViewKind {
  return UNIT_DEFINITIONS.some((unit) => unit.unitId === value);
}

export function formatTime(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '0:00';
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

export function playModeLabel(mode: PlayModeState | null | undefined): string {
  if (mode?.isShuffling) return 'Shuffle';
  switch (mode?.repeatMode) {
    case 'List':
      return 'List Loop';
    case 'Track':
    case 'One':
    case 'Single':
      return 'Single Loop';
    default:
      return 'Sequential';
  }
}

export function playModeIcon(mode: PlayModeState | null | undefined): string {
  if (mode?.isShuffling) return 'mdi-shuffle';
  switch (mode?.repeatMode) {
    case 'List':
      return 'mdi-repeat';
    case 'Track':
    case 'One':
    case 'Single':
      return 'mdi-repeat-once';
    default:
      return 'mdi-arrow-right';
  }
}

export function coverImageSource(song: NeteaseSong | null | undefined): string {
  const cover = resolveCoverValue(song).trim();
  if (!cover) return '';
  if (cover.startsWith('data:')) return cover;
  if (isSafeRemoteCoverUrl(cover)) return cover;
  if (/^[a-z][a-z\d+.-]*:\/\//i.test(cover)) return '';
  const mimeType = song?.coverMimeType?.trim() || 'image/jpeg';
  return `data:${mimeType};base64,${cover}`;
}

function resolveCoverValue(song: NeteaseSong | null | undefined): string {
  if (!song) return '';

  const flexLinkCover = song.cover;
  if (typeof flexLinkCover !== 'string' && flexLinkCover?.type === 'Base64' && flexLinkCover.value) {
    return flexLinkCover.value;
  }
  if (song.coverBase64) return song.coverBase64;
  if (typeof flexLinkCover === 'string') return flexLinkCover;
  if (flexLinkCover?.value) return flexLinkCover.value;
  if (song.originalCoverUrl) return song.originalCoverUrl;
  if (song.picUrl) return song.picUrl;
  if (song.album?.picUrl) return song.album.picUrl;
  return '';
}

function isSafeRemoteCoverUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

export function splitLyricText(text: string): string[] {
  if (!text) return [];
  const hasCjk = /[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af]/.test(text);
  if (hasCjk) return Array.from(text);
  const parts = text.split(/(\s+)/);
  return parts.filter((part) => part.length > 0);
}
