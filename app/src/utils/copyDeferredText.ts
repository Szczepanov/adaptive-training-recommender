/** Thrown when a newer copy request started before this one reached the clipboard. */
export class StaleCopyError extends Error {
  constructor() {
    super('A newer copy request superseded this one.');
    this.name = 'StaleCopyError';
  }
}

let latestRequestId = 0;

/**
 * Copies text that is still being computed. `navigator.clipboard.write` must be invoked
 * synchronously inside the click handler (before any `await`) so WebKit keeps the transient
 * user activation; the pending text is handed over as a promise inside a `ClipboardItem`.
 * Falls back to awaiting the text and `writeText` where deferred items are unsupported; on that
 * path an older request never overwrites a newer one (it rejects with `StaleCopyError`).
 */
export async function copyDeferredText(text: Promise<string>): Promise<void> {
  const requestId = ++latestRequestId;
  const clipboard = typeof navigator === 'undefined' ? undefined : navigator.clipboard;
  if (typeof ClipboardItem !== 'undefined' && typeof clipboard?.write === 'function') {
    try {
      await clipboard.write([
        new ClipboardItem({ 'text/plain': text.then(value => new Blob([value], { type: 'text/plain' })) }),
      ]);
      return;
    } catch {
      // Browser without deferred ClipboardItem support (or the text failed): retry below.
    }
  }
  if (typeof clipboard?.writeText === 'function') {
    const value = await text;
    if (requestId !== latestRequestId) throw new StaleCopyError();
    await clipboard.writeText(value);
    return;
  }
  // Surface a text failure before the unavailable-API error.
  await text;
  throw new Error('Clipboard API is unavailable in this environment.');
}
