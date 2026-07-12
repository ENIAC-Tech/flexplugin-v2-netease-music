export interface PlaybackSubscriptionLifecycleOptions<TEvent> {
  subscribe(handler: (event: TEvent) => Promise<void>): Promise<() => Promise<void>>;
  apply(event: TEvent): boolean;
  afterRender(): Promise<void>;
  notify(): void;
  logError(error: unknown): void;
  requestFrame(callback: FrameRequestCallback): number;
  cancelFrame(id: number): void;
  onFrame(timestamp: number): void;
}

export function createPlaybackSubscriptionLifecycle<TEvent>(options: PlaybackSubscriptionLifecycleOptions<TEvent>) {
  let mounted = false;
  let lifecycleGeneration = 0;
  let subscriptionGeneration = 0;
  let subscriptionPending = false;
  let unsubscribe: (() => Promise<void>) | null = null;
  let frameId: number | null = null;

  const valid = (lifecycle: number, subscription: number) =>
    mounted && lifecycle === lifecycleGeneration && subscription === subscriptionGeneration;

  const dispose = async (cleanup: () => Promise<void>) => {
    try {
      await cleanup();
    } catch (error) {
      options.logError(error);
    }
  };

  const frame = (lifecycle: number, timestamp: number) => {
    if (!mounted || lifecycle !== lifecycleGeneration) return;
    options.onFrame(timestamp);
    frameId = options.requestFrame((nextTimestamp) => frame(lifecycle, nextTimestamp));
  };

  return {
    mount() {
      if (mounted) return;
      mounted = true;
      const lifecycle = ++lifecycleGeneration;
      frameId = options.requestFrame((timestamp) => frame(lifecycle, timestamp));
    },

    async subscribe() {
      if (!mounted || subscriptionPending || unsubscribe) return;
      subscriptionPending = true;
      const lifecycle = lifecycleGeneration;
      const subscription = ++subscriptionGeneration;
      const handler = async (event: TEvent) => {
        if (!valid(lifecycle, subscription)) return;
        try {
          if (!options.apply(event) || !valid(lifecycle, subscription)) return;
          await options.afterRender();
          if (valid(lifecycle, subscription)) options.notify();
        } catch (error) {
          options.logError(error);
        }
      };
      try {
        const cleanup = await options.subscribe(handler);
        if (!valid(lifecycle, subscription)) await dispose(cleanup);
        else unsubscribe = cleanup;
      } catch (error) {
        options.logError(error);
      } finally {
        subscriptionPending = false;
      }
    },

    unmount() {
      if (!mounted) return;
      mounted = false;
      ++lifecycleGeneration;
      ++subscriptionGeneration;
      if (frameId !== null) options.cancelFrame(frameId);
      frameId = null;
      const cleanup = unsubscribe;
      unsubscribe = null;
      if (cleanup) void dispose(cleanup);
    }
  };
}
