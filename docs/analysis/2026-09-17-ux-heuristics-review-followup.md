# Adaptive Coach UX Review — Follow-Up Pass

**Date:** 2026-09-17
**Method:** live walkthrough of a fresh account against real Firebase auth/Firestore emulators (Home, Plan, More drawer, Training Setup, Coach Preferences, Goals), cross-referenced against source before reporting any finding.
**Build reviewed:** `main` @ `81e1b663`
**Disposition:** second, smaller pass following the 2026-09-16 review ([`2026-09-16-ux-heuristics-review.md`](./2026-09-16-ux-heuristics-review.md)) and its three PRs (#588, #619, #620). One finding fixed in [PR #622](https://github.com/Szczepanov/adaptive-training-recommender/pull/622); one filed as [#623](https://github.com/Szczepanov/adaptive-training-recommender/issues/623) for a future pass.

## Findings

**1. Fixed — `WeekAheadStrip.tsx`'s per-day rationale leaked the same engine jargon PR #588 already filtered elsewhere.** The 7-Day Outlook panel (shared by Home and Plan) rendered a selected day's `rationale` completely unfiltered: `"Base phase. Coverage tier: 1. Benefit score: 1.27, Fatigue cost penalty: 1.30. (Advances an explicit required weekly programming role.) (Sequence intent: recondition/spread, preferred key gap 2d.)"`. PR #588's fix to `MorningDecisionCard.tsx` never reached this sibling component. Fixed in [PR #622](https://github.com/Szczepanov/adaptive-training-recommender/pull/622) by extracting the extraction logic into a shared `app/src/utils/rationaleDisplay.ts` and applying it to both components. Verified `ExternalPlanWeek.tsx` and `ExternalVerdictBanner.tsx`'s rationale fields come from a separate, already-plain-English source (`externalPlacement.ts`/`externalSession.ts`) and needed no change.

**2. Filed as [#623](https://github.com/Szczepanov/adaptive-training-recommender/issues/623) — Coach Preferences didn't get the progressive-disclosure treatment Training Setup got.** #589/#620 fixed Training Setup's "one long, fully-expanded page" problem with the new `SettingsDisclosure` component. Coach Preferences (`app/src/components/preferences/`) has the identical problem and none of its section components adopted the fix — confirmed via `grep -rln "SettingsDisclosure" app/src/components` returning only `SettingsDisclosure.tsx` and `TrainingSettings.tsx`. Training Setup's own copy explicitly cross-references Coach Preferences as a sibling settings surface, so the two pages now read as inconsistent siblings. Not fixed in this pass — it is a multi-file structural refactor comparable in size to #589/#620 itself.

## Areas reviewed with no new findings

Home, Plan, More drawer, Training Setup (post-#620), Goals. Sessions, Testing, Body composition/anthropometry, and Adherence screens were not reached in this pass.
