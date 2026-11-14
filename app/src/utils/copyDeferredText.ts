/**
 * Copies text that is still being computed. `navigator.clipboard.write` must be invoked
 * synchronously inside the click handler (before any `await`) so WebKit keeps the transient
 * user activation; the pending text is handed over as a promise inside a `ClipboardItem`.
 * Falls back to awaiting the text and `writeText` where deferred items are unsupported.
 */
export async function copyDeferredText(text: Promise<string>): Promise<void> {
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
    await clipboard.writeText(await text);
    return;
  }
  // Surface a text failure before the unavailable-API error.
  await text;
  throw new Error('Clipboard API is unavailable in this environment.');
}
