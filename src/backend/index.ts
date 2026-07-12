import { FlexPluginBase } from '@flexsdk/runtime';
import type { PluginDefinitionsPayload, PluginEventEnvelope, PluginLoadContext } from '@flexsdk/types';
import {
  createDefaultUnitData,
  type CompactPlaybackState,
  DEFAULT_PLAYBACK_STATE,
  type PlaybackState,
  PLUGIN_UUID,
  type PlayerCommand,
  UNIT_DEFINITIONS,
  type ViewKind
} from '../common/netease';
import {
  NETEASE_LINK_METHODS,
  NETEASE_LINK_PLAYBACK_CHANNEL,
  NETEASE_LINK_PLUGIN_UUID,
  type NeteaseLinkConnectionStatus,
  type NeteaseLinkRpcResult
} from '../common/netease-link';

interface LoadedCycledUnitSlot {
  uuid: string;
  serialNumber: string;
}

const CONTROL_COMMANDS: Partial<Record<ViewKind, PlayerCommand>> = {
  previous: 'previous',
  next: 'next',
  'play-mode': 'togglePlayMode',
  'play-pause': 'togglePlayPause'
};
const MAX_RENDERER_PAYLOAD_BYTES = 64 * 1024;

function clonePlaybackState(state: PlaybackState): PlaybackState {
  return JSON.parse(JSON.stringify(state)) as PlaybackState;
}

function createInitialPlaybackState(): PlaybackState {
  return {
    ...clonePlaybackState(DEFAULT_PLAYBACK_STATE),
    lastUpdatedAt: Date.now()
  };
}

export default class NeteaseMusicPlugin extends FlexPluginBase {
  private state: PlaybackState = createInitialPlaybackState();
  private cycledUnitSlots = new Map<ViewKind, Map<string, LoadedCycledUnitSlot>>();
  private warnedSetFunctionUnavailable = false;
  private lastLinkErrorMessage: string | null = null;
  private unloaded = false;
  private dependencyUnsubscribe: (() => void) | null = null;
  private providerEpoch = -1;
  private providerRevision = -1;
  private publicationQueue: Promise<void> = Promise.resolve();
  private eventQueue: Promise<void> = Promise.resolve();

  async getDefinitions(): Promise<PluginDefinitionsPayload> {
    const pluginVersion = this.pluginVersion || '1.0.0';

    return {
      libraries: [
        this.createDefaultLibrary({
          libraryUUID: PLUGIN_UUID,
          name: 'NeteaseMusic',
          icon: 'mdi-music-circle',
          categoryId: 'music'
        })
      ],
      units: UNIT_DEFINITIONS.map((unit) => {
        const isCustomUnit = unit.pluginType === 'custom';
        const definition = this.createUnitTemplate({
          unitId: unit.unitId,
          typeId: unit.typeId,
          name: unit.name,
          categoryId: 'music',
          icon: unit.icon,
          hasFunctionEditor: isCustomUnit,
          hasAppearanceEditor: isCustomUnit,
          hasView: isCustomUnit,
          platforms: ['win32'],
          libraryUUID: PLUGIN_UUID,
          plugin: {
            type: unit.pluginType as any,
            pluginUUID: PLUGIN_UUID,
            pluginVersion,
            unitId: unit.unitId
          },
          defaultData: createDefaultUnitData(unit.unitId)
        } as any) as any;

        if (unit.functions) {
          definition.functions = unit.functions;
        }
        if (unit.appearanceOverride) {
          definition.appearanceOverride = unit.appearanceOverride;
        }
        return definition;
      }) as any,
      revision: pluginVersion
    };
  }

  async onLoad(ctx: PluginLoadContext): Promise<void> {
    await super.onLoad(ctx);
    this.unloaded = false;

    await this.registerRendererStateChannel(NETEASE_LINK_PLAYBACK_CHANNEL);
    this.dependencyUnsubscribe = await this.onDependencyState(
      NETEASE_LINK_PLUGIN_UUID,
      NETEASE_LINK_PLAYBACK_CHANNEL,
      async (event: any) => this.queueDependencyPlaybackEvent(event),
      { replayLatest: true }
    );

    this.registerRendererRpc('getPlaybackState', async () => this.getPlaybackStateForRenderer());
    this.registerRendererRpc('getConnectionStatus', async () => this.getConnectionStatusForRenderer());
    this.registerRendererRpc('sendPlayerCommand', async (command: PlayerCommand) => this.handlePlayerCommand(command));
    this.registerRendererRpc('installFlexLinkPlugin', async () =>
      this.callLinkApi<NeteaseLinkRpcResult>(NETEASE_LINK_METHODS.installFlexLinkPlugin)
    );
    this.registerRendererRpc('openExternalUrl', async (url: string) =>
      this.callLinkApi<NeteaseLinkRpcResult>(NETEASE_LINK_METHODS.openExternalUrl, [url])
    );
    this.registerRendererRpc('reportUnitViewDiagnostic', async (diagnostic: Record<string, any>) =>
      this.reportUnitViewDiagnostic(diagnostic)
    );

    for (const unit of UNIT_DEFINITIONS) {
      const command = CONTROL_COMMANDS[unit.unitId];
      if (!command) continue;
      await this.onUnitEvent(unit.typeId, 'changed', async (event: PluginEventEnvelope) => {
        this.logger.debug('Control unit changed', { typeId: unit.typeId, payload: event.payload });
        await this.handlePlayerCommand(command);
      });
    }

    for (const unit of UNIT_DEFINITIONS) {
      if (unit.pluginType !== 'cycled') continue;
      await this.onUnitEvent(
        unit.typeId,
        'load',
        async (event: PluginEventEnvelope) => this.handleCycledUnitLoad(unit.unitId, event),
        { snapshot: true }
      );
      await this.onUnitEvent(unit.typeId, 'unload', async (event: PluginEventEnvelope) =>
        this.handleCycledUnitUnload(unit.unitId, event)
      );
    }

  }

  async onUnload(): Promise<void> {
    this.unloaded = true;
    const unsubscribe = this.dependencyUnsubscribe;
    this.dependencyUnsubscribe = null;
    unsubscribe?.();
    await this.eventQueue.catch(() => undefined);
    await this.publicationQueue.catch(() => undefined);
    this.cycledUnitSlots.clear();
    await super.onUnload();
  }

  private async getPlaybackStateForRenderer(): Promise<PlaybackState> {
    return clonePlaybackState(this.state);
  }

  private async getConnectionStatusForRenderer(): Promise<NeteaseLinkConnectionStatus> {
    try {
      return await this.callLinkApi<NeteaseLinkConnectionStatus>(NETEASE_LINK_METHODS.getConnectionStatus, [
        { connect: true }
      ]);
    } catch (error) {
      const message = this.describeError(error);
      this.applyLinkError(message, 'connection-status');
      return {
        connected: false,
        currentSong: null,
        lastUpdatedAt: this.state.lastUpdatedAt,
        error: this.state.connectionError,
        webSocketUrl: undefined
      };
    }
  }

  private async handlePlayerCommand(command: PlayerCommand): Promise<NeteaseLinkRpcResult> {
    try {
      const result = await this.callLinkApi<NeteaseLinkRpcResult>(NETEASE_LINK_METHODS.sendPlayerCommand, [command]);
      return result;
    } catch (error) {
      const message = this.describeError(error);
      this.applyLinkError(message, 'command');
      return { success: false, error: this.state.connectionError ?? message };
    }
  }

  private async reportUnitViewDiagnostic(diagnostic: Record<string, any>): Promise<NeteaseLinkRpcResult> {
    const payload: Record<string, any> = {
      ...this.normalizeUnitViewDiagnostic(diagnostic),
      sourcePluginUUID: PLUGIN_UUID
    };
    try {
      return await this.callLinkApi<NeteaseLinkRpcResult>(NETEASE_LINK_METHODS.reportDiagnostic, [payload]);
    } catch (error) {
      this.logger.debug('Failed to forward unit view diagnostic to dependency plugin', {
        error: this.describeError(error),
        event: payload.event
      });
      return { success: false, error: this.describeError(error) };
    }
  }

  private normalizeUnitViewDiagnostic(diagnostic: Record<string, any>): Record<string, any> {
    return {
      event: this.readString(diagnostic?.event) ?? 'unknown',
      viewKind: this.readString(diagnostic?.viewKind),
      songName: this.readString(diagnostic?.songName),
      coverSourceKind: this.readString(diagnostic?.coverSourceKind),
      coverSourceLength: Number(diagnostic?.coverSourceLength ?? 0),
      coverPreview: this.readString(diagnostic?.coverPreview)?.slice(0, 120) ?? null,
      error: this.readString(diagnostic?.error)
    };
  }

  private queueDependencyPlaybackEvent(event: any): Promise<void> {
    if (this.unloaded) return this.eventQueue;
    const apply = () => this.handleDependencyPlaybackEvent(event);
    this.eventQueue = this.eventQueue.then(apply, apply);
    return this.eventQueue;
  }

  private async handleDependencyPlaybackEvent(event: any): Promise<void> {
    if (this.unloaded) return;
    const epoch = Number(event?.providerEpoch);
    const revision = Number(event?.revision);
    if (!Number.isFinite(epoch) || !Number.isFinite(revision)) return;
    if (epoch < this.providerEpoch || (epoch === this.providerEpoch && revision <= this.providerRevision)) return;

    const higherEpoch = epoch > this.providerEpoch;
    this.providerEpoch = epoch;
    this.providerRevision = revision;

    if (event.kind === 'available') {
      if (higherEpoch) await this.acceptPlaybackState(this.createWaitingPlaybackState(event.timestamp));
      return;
    }
    if (event.kind === 'unavailable') {
      await this.acceptPlaybackState({
        ...this.createWaitingPlaybackState(event.timestamp),
        connectionError: 'NeteaseMusicLinkEssentials unavailable.'
      });
      return;
    }
    if (higherEpoch && event.kind !== 'snapshot') {
      await this.acceptPlaybackState(this.createWaitingPlaybackState(event.timestamp));
      return;
    }
    if (event.resyncRequired && event.kind !== 'snapshot') {
      await this.acceptPlaybackState(this.createWaitingPlaybackState(event.timestamp));
      return;
    }
    if (event.kind !== 'snapshot' || !this.asRecord(event.payload)) return;
    await this.acceptPlaybackState(this.normalizePlaybackState(event.payload));
  }

  private async acceptPlaybackState(nextState: PlaybackState): Promise<void> {
    if (this.unloaded) return;
    const previousSignature = this.getCycledStateSignature();
    this.state = nextState;
    this.lastLinkErrorMessage = null;
    if (this.getCycledStateSignature() !== previousSignature) await this.syncAllCycledUnitStates();
    await this.queueRendererSnapshot(this.projectCompactPlaybackState(nextState));
  }

  private createWaitingPlaybackState(timestamp: unknown): PlaybackState {
    return { ...clonePlaybackState(DEFAULT_PLAYBACK_STATE), lastUpdatedAt: Number(timestamp) || Date.now(),
      connectionError: 'Waiting for NeteaseMusicLinkEssentials playback snapshot.' };
  }

  private projectCompactPlaybackState(state: PlaybackState): CompactPlaybackState {
    const safeUrl = (value: unknown): string | undefined =>
      typeof value === 'string' && /^https?:\/\//i.test(value) ? value.slice(0, 2048) : undefined;
    const compactString = (value: unknown): string | undefined =>
      typeof value === 'string' && value.trim() ? value.trim().slice(0, 4096) : undefined;
    const lyric = state.currentLyric;
    const song = state.song;
    const finiteNumber = (value: unknown): number => Number.isFinite(Number(value)) ? Number(value) : 0;
    const payload: CompactPlaybackState = {
      connected: Boolean(state.connected), connectionError: compactString(state.connectionError) ?? null,
      song: song ? {
        songName: compactString(song.songName), authorName: compactString(song.authorName),
        albumName: compactString(song.albumName),
        ncmId: Number.isFinite(Number(song.ncmId)) ? Number(song.ncmId) : undefined,
        duration: Number.isFinite(Number(song.duration)) ? Number(song.duration) : undefined,
        originalCoverUrl: safeUrl(song.originalCoverUrl), coverUrl: safeUrl(song.coverUrl), picUrl: safeUrl(song.picUrl),
        album: song.album ? { picUrl: safeUrl(song.album.picUrl), coverUrl: safeUrl(song.album.coverUrl) } : undefined
      } : null,
      playState: compactString(state.playState) ?? 'Stopped',
      timeline: { currentTime: finiteNumber(state.timeline.currentTime), totalTime: finiteNumber(state.timeline.totalTime) },
      playMode: { isShuffling: Boolean(state.playMode.isShuffling), repeatMode: compactString(state.playMode.repeatMode) ?? 'Off' },
      currentLyric: lyric ? {
        lineIndex: Number.isFinite(Number(lyric.lineIndex)) ? Number(lyric.lineIndex) : undefined,
        wordIndex: Number.isFinite(Number(lyric.wordIndex)) ? Number(lyric.wordIndex) : undefined,
        line: lyric.line ? { originalLyric: compactString(lyric.line.originalLyric), translatedLyric: compactString(lyric.line.translatedLyric) } : undefined,
        nextLine: lyric.nextLine ? { originalLyric: compactString(lyric.nextLine.originalLyric), translatedLyric: compactString(lyric.nextLine.translatedLyric) } : undefined
      } : null,
      lastUpdatedAt: finiteNumber(state.lastUpdatedAt)
    };
    if (Buffer.byteLength(JSON.stringify(payload), 'utf8') <= MAX_RENDERER_PAYLOAD_BYTES) return payload;
    const fallback: CompactPlaybackState = {
      connected: false,
      connectionError: 'Playback state exceeded the 64 KiB renderer channel limit.',
      song: null,
      playState: 'Stopped',
      timeline: { currentTime: 0, totalTime: 0 },
      playMode: { isShuffling: false, repeatMode: 'Off' },
      currentLyric: null,
      lastUpdatedAt: Number.isFinite(Number(state.lastUpdatedAt)) ? Number(state.lastUpdatedAt) : 0
    };
    if (Buffer.byteLength(JSON.stringify(fallback), 'utf8') > MAX_RENDERER_PAYLOAD_BYTES) {
      throw new Error('Internal compact playback fallback exceeded renderer channel limit');
    }
    return fallback;
  }

  private queueRendererSnapshot(state: CompactPlaybackState): Promise<void> {
    if (this.unloaded) return this.publicationQueue;
    const payload = JSON.parse(JSON.stringify(state)) as CompactPlaybackState;
    const publish = async () => {
      if (this.unloaded) return;
      try {
        await this.publishRendererState(NETEASE_LINK_PLAYBACK_CHANNEL, { kind: 'snapshot', payload: payload as any });
      } catch (error) {
        this.logger.warn('Failed to publish Netease renderer playback state', { error: this.describeError(error) });
      }
    };
    this.publicationQueue = this.publicationQueue.then(publish, publish);
    return this.publicationQueue;
  }

  private normalizePlaybackState(value: PlaybackState): PlaybackState {
    const record = this.asRecord(value) ?? {};
    const timeline = this.asRecord(record.timeline);
    const playMode = this.asRecord(record.playMode);
    const lastUpdatedAt = Number(record.lastUpdatedAt ?? Date.now());
    return {
      connected: Boolean(record.connected),
      song: (record.song as PlaybackState['song']) ?? null,
      playState: this.readString(record.playState) ?? 'Stopped',
      timeline: {
        currentTime: Number.isFinite(Number(timeline?.currentTime)) ? Number(timeline?.currentTime) : 0,
        totalTime: Number.isFinite(Number(timeline?.totalTime)) ? Number(timeline?.totalTime) : 0
      },
      playMode: {
        isShuffling: Boolean(playMode?.isShuffling),
        repeatMode: String(playMode?.repeatMode ?? 'Off')
      },
      lyrics: null,
      currentLyric: (record.currentLyric as PlaybackState['currentLyric']) ?? null,
      lastUpdatedAt: Number.isFinite(lastUpdatedAt) ? lastUpdatedAt : Date.now(),
      connectionError: this.readString(record.connectionError)
    };
  }

  private applyLinkError(message: string, source: string): void {
    const connectionError = `NeteaseMusicLinkEssentials unavailable: ${message}`;
    this.state = {
      ...clonePlaybackState(DEFAULT_PLAYBACK_STATE),
      lastUpdatedAt: Date.now(),
      connectionError
    };

    if (connectionError === this.lastLinkErrorMessage) return;
    this.lastLinkErrorMessage = connectionError;
    this.logger.warn('Failed to read NeteaseMusicLinkEssentials dependency API', {
      source,
      dependency: NETEASE_LINK_PLUGIN_UUID,
      error: message
    });
  }

  private async callLinkApi<T>(method: string, params: any[] = []): Promise<T> {
    return await this.hostApi.plugin.callDependency<T>(NETEASE_LINK_PLUGIN_UUID, method, params);
  }

  private handleCycledUnitLoad(viewKind: ViewKind, event: PluginEventEnvelope): void {
    const slot = this.readLoadedUnitSlot(event);
    if (!slot) {
      this.logger.debug('Ignored cycled unit load without slot identity', {
        viewKind,
        payload: event.payload
      });
      return;
    }

    this.getCycledSlots(viewKind).set(this.getSlotKey(slot), slot);
    void this.syncCycledUnitState(viewKind, slot);
  }

  private handleCycledUnitUnload(viewKind: ViewKind, event: PluginEventEnvelope): void {
    const slot = this.readLoadedUnitSlot(event);
    if (!slot) return;
    this.cycledUnitSlots.get(viewKind)?.delete(this.getSlotKey(slot));
  }

  private readLoadedUnitSlot(event: PluginEventEnvelope): LoadedCycledUnitSlot | null {
    const outer = this.asRecord(event.payload);
    const payload = this.asRecord(outer?.payload) ?? outer;
    const context = this.asRecord(outer?.context);
    const uuid = this.readString(payload?.uuid);
    const serialNumber = this.readString(payload?.serialNumber) ?? this.readString(context?.serialNumber);
    if (!uuid || !serialNumber) return null;
    return { uuid, serialNumber };
  }

  private asRecord(value: unknown): Record<string, any> | null {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, any>)
      : null;
  }

  private readString(value: unknown): string | null {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
  }

  private getCycledSlots(viewKind: ViewKind): Map<string, LoadedCycledUnitSlot> {
    let slots = this.cycledUnitSlots.get(viewKind);
    if (!slots) {
      slots = new Map<string, LoadedCycledUnitSlot>();
      this.cycledUnitSlots.set(viewKind, slots);
    }
    return slots;
  }

  private getSlotKey(slot: LoadedCycledUnitSlot): string {
    return `${slot.serialNumber}\u0000${slot.uuid}`;
  }

  private getCycledStateSignature(): string {
    return [
      this.resolvePlayPauseFunctionId(),
      this.resolvePlayModeFunctionId()
    ].join('|');
  }

  private resolvePlayPauseFunctionId(): string {
    const playState = String(this.state.playState ?? '').toLowerCase();
    const isPlaying =
      playState.includes('play') &&
      !playState.includes('pause') &&
      !playState.includes('stop');
    return isPlaying ? 'pause' : 'play';
  }

  private resolvePlayModeFunctionId(): string {
    if (this.state.playMode?.isShuffling) return 'shuffle';
    switch (this.state.playMode?.repeatMode) {
      case 'List':
        return 'repeat-list';
      case 'Track':
      case 'One':
      case 'Single':
        return 'repeat-one';
      default:
        return 'sequential';
    }
  }

  private resolveCycledFunctionId(viewKind: ViewKind): string | null {
    switch (viewKind) {
      case 'play-pause':
        return this.resolvePlayPauseFunctionId();
      case 'play-mode':
        return this.resolvePlayModeFunctionId();
      default:
        return null;
    }
  }

  private async syncAllCycledUnitStates(): Promise<void> {
    await Promise.all([
      this.syncCycledUnitState('play-pause'),
      this.syncCycledUnitState('play-mode')
    ]);
  }

  private async syncCycledUnitState(viewKind: ViewKind, slot?: LoadedCycledUnitSlot): Promise<void> {
    const functionId = this.resolveCycledFunctionId(viewKind);
    if (!functionId) return;
    const targets = slot ? [slot] : Array.from(this.cycledUnitSlots.get(viewKind)?.values() ?? []);
    await Promise.all(targets.map((target) => this.setCycledUnitFunction(viewKind, target, functionId)));
  }

  private async setCycledUnitFunction(
    viewKind: ViewKind,
    slot: LoadedCycledUnitSlot,
    functionId: string
  ): Promise<void> {
    const unitApi = (this.hostApi as any)?.unit;
    if (typeof unitApi?.setFunction !== 'function') {
      if (!this.warnedSetFunctionUnavailable) {
        this.warnedSetFunctionUnavailable = true;
        this.logger.warn('Host API unit.setFunction is unavailable; cycled unit state sync is disabled');
      }
      return;
    }

    try {
      await unitApi.setFunction(slot.serialNumber, slot.uuid, functionId);
    } catch (error) {
      this.logger.debug('Failed to sync cycled unit function', {
        viewKind,
        uuid: slot.uuid,
        serialNumber: slot.serialNumber,
        functionId,
        error: this.describeError(error)
      });
    }
  }

  private describeError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
