import { expect, type Page } from '@playwright/test';

// Every way recommendationService reports a rejected or degraded daily_recommendations write.
// The service deliberately swallows these so Home still renders, which is exactly why an
// otherwise-green journey must fail on them (#953).
const FORBIDDEN_CONSOLE_PATTERNS = [
  /Permission denied saving recommendation/,
  /maximum of 1000 expressions/,
  /Error saving recommendation/,
  /Immutable decision context could not be committed/,
];

/**
 * Attaches a browser console listener that records any write-rejection or expression-limit
 * errors from Firestore emulator operations on recommendation documents.
 * Returns a callback that asserts zero forbidden messages were received.
 */
export function attachRecommendationConsoleTrap(page: Page): () => void {
  const trappedErrors: string[] = [];
  const listener = (msg: { text: () => string }) => {
    const text = msg.text();
    for (const pattern of FORBIDDEN_CONSOLE_PATTERNS) {
      if (pattern.test(text)) {
        trappedErrors.push(text);
      }
    }
  };
  page.on('console', listener);

  return () => {
    page.off('console', listener);
    expect(
      trappedErrors,
      `Forbidden recommendation write rejection trapped in browser console:\n${trappedErrors.join('\n')}`,
    ).toEqual([]);
  };
}
