# Morning Decision UX contracts

This document records the implementation contracts behind the morning-decision progressive-disclosure UI introduced in PR #233. The dashboard is an execution surface over the recommendation engine; it must not invent stronger safety, physiological, or persistence semantics than the engine and stored data provide.

## 1. Progressive disclosure

The morning card answers three questions in order:

1. **What should I do today?** Show the current recommendation, dose, modality, and primary action.
2. **Why?** Summarize the inputs and engine envelopes that materially explain the decision.
3. **What should make me change it?** Expose safety boundaries, invalidation triggers, and low-friction alternatives.

Expanded evidence is explanatory. The engine recommendation and its safety/plan envelopes remain authoritative.

## 2. Safety and harder-load adjustments

The UI must not offer a harder adjustment when any represented hard boundary is active. `decisionEvidence.ts` therefore locks the harder option when:

- the safety envelope contains an active clinical flag;
- one or more modalities are restricted by the safety envelope;
- the current subjective check-in reports illness symptoms;
- the plan envelope caps the day at `Rest` or `Mobility`;
- the recommendation is already in `recover` mode.

Reported soreness without an engine restriction is presented as **cautionary context**, not promoted into a new engine hard gate.

Wearable values are described as signals rather than diagnoses or causal physiological claims. A missing prior-day snapshot must be stated as missing; it must not be described as day-over-day stability.

## 3. Confidence semantics

`computeDataConfidence` is an input-availability rating for the displayed decision, not a probability that the workout is objectively correct.

- **High** requires the core Garmin overnight signals used by this view plus a complete subjective check-in.
- **Moderate** represents partial wearable data or a complete check-in without the core wearable corroboration.
- **Low** represents sparse or unavailable decision inputs.

An existing but incomplete check-in cannot receive the High label.

## 4. One-tap alternatives and immutable execution

`Recommendation.primarySession` is an immutable binding for the originally authored recommendation. Once the athlete selects a time-crunch alternative or changes the load, that original binding is stale by definition.

The execution rule is therefore:

- unchanged recommendation -> launch the stored `primarySession` binding;
- adjusted/alternative recommendation -> author the **currently displayed prescription** through `prepareCatalogSessionLaunch`, then launch the returned immutable binding.

This keeps the runner, replay, and prescription-hash contracts aligned with what the athlete actually sees and chooses. The UI must never display one prescription while silently executing the original binding.

## 5. Garmin activity corrections

Activity corrections are stored at:

`users/{userId}/activity_overrides/{activityId}`

The Firestore rules require ownership, path/activity identity, a real activity date, bounded enum values, and stable `activityId`, `date`, and `createdAt` across updates. Cross-user reads and writes are denied.

The correction editor initializes from the selected Garmin activity and, when present, the saved override. Reset means deleting the override; a failed delete must remain visible to the athlete instead of being treated as success.

### Downstream interpretation

`completedTraining.ts` uses athlete corrections as follows:

- corrected **modality** and **intensity** replace Garmin's inferred values for the completed-training event;
- corrected modality/intensity select the corresponding default cost and stimulus profiles;
- optional `stimulusFocus` raises the selected stimulus axis to a conservative floor for the chosen intensity;
- athlete-corrected events use the `athleteClassification` evidence tier and do not also apply Garmin power-zone direct-share inference;
- correction notes are retained as athlete feedback context;
- RPE is stored for audit/context in the correction record, but is **not currently an independent load multiplier** in `completedTraining.ts`.

That last distinction is intentional documentation of current behavior; the UI must not imply that changing RPE alone recalculates training cost.

## 6. Rapid onboarding completion

The rapid wizard persists training settings before creating the active goal. The active goal is used by the app as an onboarding-complete signal, so creating it first could suppress the wizard after a partial write failure while leaving equipment/time settings at defaults.

Failures remain in the wizard with the athlete's current selections intact so completion can be retried safely.

## 7. Usability telemetry

`usabilityMetrics.ts` is local task telemetry, not a remote analytics pipeline.

- events are stored in browser `localStorage` when available;
- storage is capped to the most recent 200 persisted events;
- recommendation TTR is measured from the **first recorded view** to the **first deliberate action** for that user/date;
- repeated renders before that action do not restart the clock;
- later actions are recorded but are not assigned the original first-action TTR;
- browser-storage failure is non-fatal and falls back to in-memory collection for the current runtime.

Do not interpret these events as server-side population telemetry unless a future backend pipeline is added explicitly.

## 8. Adherence quick actions

Keyboard shortcuts `[1]`, `[2]`, and `[3]` are convenience controls. A synchronous in-flight guard prevents key repeat or rapid click/key combinations from enqueuing duplicate adherence writes before React state has re-rendered the disabled controls.

## 9. Verification

The change set is covered by:

- decision-evidence unit tests for safety locks, confidence, deltas, and alternative IDs;
- usability-metrics unit tests for first-action timing behavior;
- Firestore emulator tests for activity-override owner CRUD, cross-user denial, malformed writes, and immutable identity/date/creation fields;
- the repository CI typecheck, lint, unit-test, catalog-validation, and production-build gates.

## 10. Wearable-Free & First-Class Email Authentication Support

### Authentication Flows
`LoginScreen.tsx` provides native email and password authentication:
- Segmented tab control toggling between **Sign In** and **Create Account (Sign Up)**;
- New password accounts are validated against the Firebase project password policy, receive an email-verification message, and remain signed out until the address is verified;
- Password reset always returns the same "if an account exists" acknowledgement, including on older Firebase projects that still return `user-not-found`;
- **Continue with Garmin** is retained as an accessible alternative sign-in and account linking flow rather than the exclusive entry point;
- After a verified first login, `initializeUserData` in `AuthContext.tsx` creates default user preferences and v3 training settings under strict `users/{userId}/...` path isolation. Garmin custom-token identities are not subject to the email-verification gate.

### Wearable-Free Recommendation Mode
When an athlete has no recovery snapshot and Garmin is canonically confirmed as disconnected:
- `garminConnectionService.ts` first observes the non-secret connection mirror, then lazily reconciles missing/unreadable mirrors through authenticated `POST /api/garmin/status` as required by ADR-0029. Connected, disconnected, and unknown remain distinct;
- `adapters.ts` provides `createSubjectiveOnlyObjectiveInput()`, setting wearable metrics and delta strains to unavailable (`null`) while revisioned training history remains completed-load authority;
- Once the athlete completes their morning check-in (fulfilling `canGenerateNormalRecommendation(safetyStatus)`), the recommendation engine produces a valid daily recommendation and 7-day plan forecast driven by subjective fatigue, soreness, sleep quality, stress, availability, and active injury gates;
- The user-facing rationale references the morning check-in directly rather than claiming Garmin baselines;
- Accounts without linked Garmin hardware suppress automated background sync polling (`useAutoGarminSync.ts`) and hide the idle Garmin sync badge in navigation (`GarminSyncBadge.tsx`);
- The dashboard replaces the Garmin recovery panel with a neutral **Wearable Optional** status;
- A connected account with a missing snapshot receives a sync/repair action. If both mirror observation and canonical verification fail, planning is blocked as unknown rather than silently treated as wearable-free.
