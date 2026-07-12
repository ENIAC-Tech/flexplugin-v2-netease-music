import { createPlaybackSubscriptionLifecycle } from '../../src/frontend/playback-subscription-lifecycle';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function harness() {
  const subscription = deferred<() => Promise<void>>();
  const render = deferred<void>();
  let handler: ((event: any) => Promise<void>) | undefined;
  const unsubscribe = jest.fn(async () => undefined);
  const subscribe = jest.fn((_handler: (event: any) => Promise<void>) => {
    handler = _handler;
    return subscription.promise;
  });
  const apply = jest.fn(() => true);
  const notify = jest.fn();
  const logError = jest.fn();
  const requestFrame = jest.fn(() => 41);
  const cancelFrame = jest.fn();
  const onFrame = jest.fn();
  const lifecycle = createPlaybackSubscriptionLifecycle({
    subscribe, apply, afterRender: () => render.promise, notify, logError,
    requestFrame, cancelFrame, onFrame
  });
  return { lifecycle, subscription, render, unsubscribe, subscribe, get handler() { return handler!; }, apply, notify, logError, requestFrame, cancelFrame, onFrame };
}

test('unmount before subscribe resolves invokes the returned unsubscribe exactly once', async () => {
  const h = harness();
  h.lifecycle.mount();
  const connecting = h.lifecycle.subscribe();
  h.lifecycle.unmount();
  h.subscription.resolve(h.unsubscribe);
  await connecting;
  h.lifecycle.unmount();
  expect(h.unsubscribe).toHaveBeenCalledTimes(1);
  expect(h.logError).not.toHaveBeenCalled();
});

test('in-flight replay cannot mutate or notify after lifecycle invalidation across render boundary', async () => {
  const h = harness();
  h.lifecycle.mount();
  const connecting = h.lifecycle.subscribe();
  const replay = h.handler({ kind: 'snapshot' });
  expect(h.apply).toHaveBeenCalledTimes(1);
  h.lifecycle.unmount();
  h.render.resolve();
  h.subscription.resolve(h.unsubscribe);
  await Promise.all([connecting, replay]);
  expect(h.notify).not.toHaveBeenCalled();

  await h.handler({ kind: 'snapshot' });
  expect(h.apply).toHaveBeenCalledTimes(1);
});

test('normal unmount cancels the frame and unsubscribes once', async () => {
  const h = harness();
  h.lifecycle.mount();
  const connecting = h.lifecycle.subscribe();
  h.subscription.resolve(h.unsubscribe);
  await connecting;
  h.lifecycle.unmount();
  h.lifecycle.unmount();
  expect(h.cancelFrame).toHaveBeenCalledTimes(1);
  expect(h.cancelFrame).toHaveBeenCalledWith(41);
  expect(h.unsubscribe).toHaveBeenCalledTimes(1);
});

test('subscription errors are logged without applying playback UI state', async () => {
  const h = harness();
  h.lifecycle.mount();
  const connecting = h.lifecycle.subscribe();
  h.subscription.reject(new Error('subscribe failed'));
  await connecting;
  expect(h.logError).toHaveBeenCalledWith(expect.any(Error));
  expect(h.apply).not.toHaveBeenCalled();
});

test('unsubscribe errors are caught and logged exactly once', async () => {
  const h = harness();
  const failedUnsubscribe = jest.fn(async () => { throw new Error('unsubscribe failed'); });
  h.lifecycle.mount();
  const connecting = h.lifecycle.subscribe();
  h.subscription.resolve(failedUnsubscribe);
  await connecting;
  h.lifecycle.unmount();
  await new Promise<void>((resolve) => setImmediate(resolve));
  h.lifecycle.unmount();
  expect(failedUnsubscribe).toHaveBeenCalledTimes(1);
  expect(h.logError).toHaveBeenCalledWith(expect.objectContaining({ message: 'unsubscribe failed' }));
  expect(h.apply).not.toHaveBeenCalled();
});
