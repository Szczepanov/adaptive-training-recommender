import { test as baseTest, expect } from '@playwright/test';
import { attachRecommendationConsoleTrap } from './consoleTrap';

/**
 * The `test` every E2E spec imports (ESLint rejects `test` from `@playwright/test` under
 * tests/e2e), so suite-wide guards apply to every journey rather than only the specs that
 * remembered to opt in. Any recommendation write rejection or degradation logged to the
 * browser console fails the test.
 */
export const test = baseTest.extend<{ recommendationConsoleTrap: void }>({
  recommendationConsoleTrap: [
    async ({ page }, use) => {
      const assertNoTrappedErrors = attachRecommendationConsoleTrap(page);
      await use();
      assertNoTrappedErrors();
    },
    { auto: true },
  ],
});

export { expect };
