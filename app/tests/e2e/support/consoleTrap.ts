import { test as baseTest, expect, type Page, type Locator } from '@playwright/test';
import { cleanupWorkerHarness } from './athlete';

const FORBIDDEN_CONSOLE_PATTERNS = [
  /Permission denied saving recommendation/,
  /maximum of 1000 expressions/,
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

/**
 * Playwright test fixture with automatic recommendation console trap and
 * worker-scoped harness cleanup.
 *
 * Any spec importing `test` from this module will fail if a recommendation
 * write error or emulator expression limit is logged to the console, and will
 * clean up shared worker-scoped emulator connections on worker teardown.
 */
export const test = baseTest.extend<{ recommendationConsoleTrap: void }, { workerHarnessCleanup: void }>({
  workerHarnessCleanup: [
    async (_fixtures, use) => {
      await use();
      await cleanupWorkerHarness();
    },
    { scope: 'worker', auto: true },
  ],
  recommendationConsoleTrap: [
    async ({ page }, use) => {
      const assertNoTrappedErrors = attachRecommendationConsoleTrap(page);
      await use();
      assertNoTrappedErrors();
    },
    { auto: true },
  ],
});

export { expect, type Page, type Locator };
