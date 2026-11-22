import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { awaitChildWithSignalShutdown, stopChild } from './runWithEmulators.mjs';

function createFakeChild(pid = 4242) {
  return Object.assign(new EventEmitter(), {
    pid,
    exitCode: null,
    signalCode: null,
  });
}

describe('stopChild', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('resolves as soon as close emits, clears its timer, detaches listeners, and calls killTreeFn', async () => {
    vi.useFakeTimers();
    const child = createFakeChild(4242);
    const killGroupCalls = [];
    const killTreeCalls = [];

    const promise = stopChild(child, {
      graceMs: 60_000,
      useProcessGroup: true,
      killGroupFn: (pid, sig) => {
        killGroupCalls.push([pid, sig]);
        queueMicrotask(() => child.emit('close', null, sig));
      },
      killTreeFn: (pid) => {
        killTreeCalls.push(pid);
      },
    });

    expect(vi.getTimerCount()).toBe(1);
    await promise;

    expect(killGroupCalls).toEqual([[4242, 'SIGINT']]);
    expect(killTreeCalls).toEqual([4242]);
    expect(child.listenerCount('close')).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('detaches the close listener and calls killTreeFn when graceMs expires first', async () => {
    vi.useFakeTimers();
    const child = createFakeChild(5151);
    const killTreeCalls = [];
    let settled = false;

    const promise = stopChild(child, {
      graceMs: 500,
      useProcessGroup: true,
      killGroupFn: () => {},
      killTreeFn: (pid) => {
        killTreeCalls.push(pid);
      },
    }).then(() => {
      settled = true;
    });

    await vi.advanceTimersByTimeAsync(499);
    expect(settled).toBe(false);
    expect(child.listenerCount('close')).toBe(1);

    await vi.advanceTimersByTimeAsync(1);
    await promise;

    expect(settled).toBe(true);
    expect(child.listenerCount('close')).toBe(0);
    expect(killTreeCalls).toEqual([5151]);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('awaitChildWithSignalShutdown', () => {
  it.each([
    { signal: 'SIGTERM', expectedExitCode: 143, closeArgs: [null, 'SIGTERM'] },
    { signal: 'SIGINT', expectedExitCode: 130, closeArgs: [0, null] },
  ])(
    'guards against the POSIX close race on $signal and exits $expectedExitCode',
    async ({ signal, expectedExitCode, closeArgs }) => {
      const child = createFakeChild(7777);
      const signalTarget = new EventEmitter();
      let cleanupCount = 0;
      const exitCalls = [];
      let releaseStop;
      const stopGate = new Promise((res) => {
        releaseStop = res;
      });
      let stopCalls = 0;

      const pending = Symbol('pending');
      let outerOutcome = pending;
      void awaitChildWithSignalShutdown({
        spawnChild: () => child,
        onCleanup: () => {
          cleanupCount += 1;
        },
        stopChildFn: async () => {
          stopCalls += 1;
          // Simulate the child closing mid-shutdown before stopChildFn finishes.
          child.emit('close', ...closeArgs);
          await stopGate;
        },
        exitFn: (code) => {
          exitCalls.push(code);
        },
        signalTarget,
      }).then(
        (code) => {
          outerOutcome = code;
        },
        (err) => {
          outerOutcome = err;
        },
      );

      expect(signalTarget.listenerCount('SIGINT')).toBe(1);
      expect(signalTarget.listenerCount('SIGTERM')).toBe(1);

      signalTarget.emit(signal);

      for (let i = 0; i < 5; i += 1) await Promise.resolve();
      expect(stopCalls).toBe(1);
      expect(outerOutcome).toBe(pending);
      expect(cleanupCount).toBe(0);
      expect(exitCalls).toEqual([]);
      expect(signalTarget.listenerCount('SIGINT')).toBe(0);
      expect(signalTarget.listenerCount('SIGTERM')).toBe(0);

      // A duplicate signal during teardown must be ignored.
      signalTarget.emit(signal);

      releaseStop();
      for (let i = 0; i < 10; i += 1) await Promise.resolve();

      expect(outerOutcome).toBe(pending);
      expect(cleanupCount).toBe(1);
      expect(exitCalls).toEqual([expectedExitCode]);
    },
  );

  it.each([0, 2])(
    'resolves with %i on normal exit, cleans up once, and detaches signals',
    async (exitCode) => {
      const child = createFakeChild(8888);
      const signalTarget = new EventEmitter();
      let cleanupCount = 0;
      let cleanedChild = null;
      const exitCalls = [];

      const promise = awaitChildWithSignalShutdown({
        spawnChild: () => child,
        onCleanup: (proc) => {
          cleanupCount += 1;
          cleanedChild = proc;
        },
        exitFn: (code) => {
          exitCalls.push(code);
        },
        signalTarget,
      });

      expect(signalTarget.listenerCount('SIGINT')).toBe(1);
      expect(signalTarget.listenerCount('SIGTERM')).toBe(1);

      child.emit('close', exitCode, null);

      await expect(promise).resolves.toBe(exitCode);
      expect(cleanupCount).toBe(1);
      expect(cleanedChild).toBe(child);
      expect(exitCalls).toEqual([]);
      expect(signalTarget.listenerCount('SIGINT')).toBe(0);
      expect(signalTarget.listenerCount('SIGTERM')).toBe(0);
    },
  );
});
