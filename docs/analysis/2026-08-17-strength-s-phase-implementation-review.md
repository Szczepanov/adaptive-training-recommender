# Strength S-task implementation review

* **Date:** 2026-08-17
* **Scope:** stacked branches `feat/s1-1-offline-persistence` through
  `feat/s3-3-measurement-and-decision`
* **Review branch:** `codex/s-phase-review`
* **Verdict:** implementation is substantially improved and production-safe while manual
  strength load remains default-off. Real-browser offline recovery and real-history cost
  calibration remain evidence obligations, not code-completeness claims.

## Findings and corrections

| Task | Review result |
|---|---|
| S1.1 | Persistent multi-tab local cache is configured and unit-pinned. A real browser kill/reload/reconnect test is still required; Node tests cannot prove IndexedDB durability. |
| S1.2 | Shared bounds now keep UI writes, parsing, and estimators aligned. The parser enforces document/session identity, Warsaw start-date attribution, lifecycle timestamp ordering, unique integer set indices, gauge ranges, and array/load/repetition bounds. |
| S1.3 | Rules now require creation as `in_progress`, bind `completedAt` to `completed`, and make terminal sessions immutable. Repository-owned composite indexes were added for active-session queries. Emulator coverage includes terminal/reopen protection. |
| S1.4 | Closing a session now merges lifecycle fields instead of rewriting the whole document and potentially erasing a concurrent set. Idempotent terminal calls preserve the original completion instant. Invalid/backward timestamps fail before write. |
| S1.5 | The planned gauge and selector cannot disagree; start/log/finish actions are mutually guarded; per-set `synced`/`pending` state comes from Firestore `hasPendingWrites`, not from local write-promise resolution. |
| S1.6 | The live rest clock follows the latest set across the whole session, so switching exercises or alternating a superset no longer resets it to session elapsed time. |
| S1.7 | The 90-day view uses an exact exclusive-end window, free-text identity is normalized and namespaced away from catalog IDs, repeated exercise entries aggregate safely, and same-day rows sort deterministically. |
| S2.1 | Invalid/out-of-range gauges can no longer qualify as near-failure evidence. The accepted Epley/admissibility policy itself was not recalibrated without data. |
| S2.2 | The original write-back API had no production caller. `strengthSessionCompletion.ts` now applies derivations as part of Finish before making the session terminal; a failed preference write leaves the session resumable. Protected provenance with a missing value is represented honestly rather than cast to `number`. |
| S3.1 | A non-strength catalog ID is no longer treated as identified strength evidence. Recommendation-linked manual logs reuse the recommendation occurrence key, preventing Garmin/adherence plus manual data from replaying one workout twice. |
| S3.2 | Default-off is now operationally inert: it issues no strength query, preserves the old revision shape, and cannot make ordinary planning fail. The enabled measurement path uses the correct exclusive window, strict ADR-0010 invalid/unavailable semantics, stable session-aware revisions, and occurrence reconciliation. |
| S3.3 | The `DEFER` decision is retained because no repository-supplied real history can authorize activation. The measurement summary now deduplicates physical occurrences and reports duplicate count, so later evidence cannot be inflated by recommendation-linked duplicates. |

## Validation evidence

* `npm run check`: 116 test files passed, one skipped; 1,399 tests passed, 58 skipped;
  TypeScript, ESLint, and workout-catalog validation passed.
* `npm run test:rules`: 58 Firestore emulator tests passed.
* `npm run build`: production bundle passed (the existing chunk-size warning remains).
* `node scripts/check-policy-drift.mjs cd1c096c816ef5b3275b139f4fa3e1bc43c0c401`:
  passed; production decision behavior remains unchanged while manual history is off.
* `npm run simulate:diff`: exits successfully and reports the same 16 pre-existing
  `[NEW SCENARIO]` entries caused by a stale committed scenario baseline; no strength
  scenario or policy delta is emitted.

## Remaining evidence gates

1. Perform the real-browser offline test: log sets, kill/reopen the tab, and reconnect.
2. Firestore rules cannot iterate through variable-length nested set arrays. The client
   validator and read parser enforce nested bounds, but the platform's 1 MiB document cap
   is the remaining server-side abuse ceiling unless the schema moves sets to subdocuments.
3. Keep `ManualTrainingPolicy` off until real logged history supports a per-day
   recommendation comparison and a deliberate policy-version/baseline change.
