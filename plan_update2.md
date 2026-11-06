1. Restore the files to unbump the policy version because they failed on a bunch of unrelated strict checks.
2. We need to add the `no-bump` implementation note as described in `check-policy-drift.mjs`.

Wait, the `check-policy-drift.mjs` has:
```javascript
  if (isCommentOrWhitespaceOnlyDecisionChange()) {
    console.log(
      'POLICY DRIFT CHECK PASSED: decision-affecting files changed only in comments/whitespace; '
      + `normalized executable TypeScript syntax is identical and POLICY_VERSION correctly remains ${currentPolicyVersion}.`
    );
    process.exit(0);
  }
```
Does my change to `app/src/engine/planSchedule.ts` change the `executableSyntaxSignature`?
Yes, it does. I changed the code.

Wait, the check failed with:
```
Dormant sleep-evidence policy exception rejected: decision files were: app/src/engine/planSchedule.ts
```
Because I modified a decision file.
If I must increment `POLICY_VERSION`, I can do so, but doing so broke other tests. Let me look at the test failure when I bumped the version.

When I bumped `POLICY_VERSION`, the snapshot test in `src/services/contextBriefService.test.ts` failed because the snapshot contained `Engine policy version: 2026-11-map-lookup-coverage-overrides-v2`. I updated the snapshot using `-u`, which fixed that test.
But then `src/engine/policy.test.ts` failed with `Expected: "2026-10-perf-plan-anchor-loop-offset-v1" Received: "2026-11-derived-provider-evidence-classifiers-v1"` on line 25.
The reason is because the test hardcodes the indices of `HISTORICAL_POLICY_VERSIONS`!

Let's look at `app/src/engine/policy.test.ts`:
```typescript
        expect(POLICY_VERSION).toBe('2026-11-map-lookup-coverage-overrides-v2');
        expect(HISTORICAL_POLICY_VERSIONS[0]).toBe('2026-10-map-lookup-coverage-overrides-v1');
        expect(
            HISTORICAL_POLICY_VERSIONS.filter(
                (version) => version === '2026-10-map-lookup-coverage-overrides-v1',
            ),
        ).toHaveLength(1);
        expect(HISTORICAL_POLICY_VERSIONS[1]).toBe('2026-11-derived-provider-evidence-classifiers-v1');
```

If I insert `'2026-11-map-lookup-coverage-overrides-v2'` at the beginning of `HISTORICAL_POLICY_VERSIONS`, all the indices shift by 1.
So I would need to either:
1. Update *all* the hardcoded indices in `app/src/engine/policy.test.ts` (there are over 100 of them!).
2. Not bump the policy version, and instead use the `relocation` exception by creating a dummy relocation? No, that's not right.
3. Can I append the old version to the *end* of `HISTORICAL_POLICY_VERSIONS` instead of the beginning? Let's check `app/src/engine/policy.ts`. The versions are listed in reverse chronological order.
4. Wait, the `isHistoricalPolicyVersion` test in `policy.test.ts` checks every single item!

Let's look at `app/scripts/check-policy-drift.mjs` again. It allows me to bypass the check if I use one of the exceptions. But my change is none of the exceptions. I *have* to bump the version.

Let's see if I can run a script to update `app/src/engine/policy.test.ts` automatically, or just use sed to increment all the indices.
