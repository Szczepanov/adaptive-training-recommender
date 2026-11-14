// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { copyDeferredText } from './copyDeferredText';

class FakeClipboardItem {
  readonly items: Record<string, Promise<Blob>>;
  constructor(items: Record<string, Promise<Blob>>) { this.items = items; }
}

function stubClipboard(clipboard: unknown, withItem: boolean) {
  vi.stubGlobal('navigator', { clipboard });
  if (withItem) vi.stubGlobal('ClipboardItem', FakeClipboardItem);
  else vi.stubGlobal('ClipboardItem', undefined);
}

afterEach(() => { vi.unstubAllGlobals(); });

describe('copyDeferredText', () => {
  it('uses ClipboardItem with the pending promise, invoked before the text resolves', async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    const writeText = vi.fn();
    stubClipboard({ write, writeText }, true);
    let resolveText!: (t: string) => void;
    const text = new Promise<string>(r => { resolveText = r; });
    const done = copyDeferredText(text);
    expect(write).toHaveBeenCalledTimes(1);
    resolveText('hello');
    await done;
    const item = write.mock.calls[0][0][0] as FakeClipboardItem;
    expect(await (await item.items['text/plain']).text()).toBe('hello');
    expect(writeText).not.toHaveBeenCalled();
  });

  it('falls back to writeText when write rejects', async () => {
    const write = vi.fn().mockRejectedValue(new Error('unsupported'));
    const writeText = vi.fn().mockResolvedValue(undefined);
    stubClipboard({ write, writeText }, true);
    await copyDeferredText(Promise.resolve('hi'));
    expect(writeText).toHaveBeenCalledWith('hi');
  });

  it('uses writeText when ClipboardItem is unavailable', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    stubClipboard({ writeText }, false);
    await copyDeferredText(Promise.resolve('hi'));
    expect(writeText).toHaveBeenCalledWith('hi');
  });

  it('throws when no clipboard API exists', async () => {
    stubClipboard(undefined, false);
    await expect(copyDeferredText(Promise.resolve('x'))).rejects.toThrow('Clipboard API is unavailable');
  });

  it('propagates a rejected text promise without writing', async () => {
    const write = vi.fn().mockImplementation(async (items: FakeClipboardItem[]) => { await items[0].items['text/plain']; });
    const writeText = vi.fn();
    stubClipboard({ write, writeText }, true);
    await expect(copyDeferredText(Promise.reject(new Error('boom')))).rejects.toThrow('boom');
    expect(writeText).not.toHaveBeenCalled();
  });
});
