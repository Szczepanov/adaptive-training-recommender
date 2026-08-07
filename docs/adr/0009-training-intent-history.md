# ADR-0009: Training intent is history-seeded

* **Status:** Accepted
* **Date:** 2026-08-07

## Decision

Training intent is derived at evaluation time from periodization plus answered adherence
history. `resolveTrainingIntent` credits completed work into the rolling microcycle,
replays its external fatigue cost, and combines that with today's readiness-derived
internal strain. No derived objective, fatigue, or phase state is persisted.

History is accessed through the engine-owned `TrainingHistoryProvider` boundary:
`reconstruct(userId, throughDateExclusive, windowDays)`. The Firestore implementation
lives outside the pure engine path and is dynamically selected only in production;
engine tests inject deterministic fixture providers. This keeps Firebase initialization
out of recommendation, periodization, fatigue, and planner tests while preserving the
same oldest-to-newest exposure semantics in production.

## Consequences

The intent resolver is asynchronous, unlike the original pure week-ahead planner in
ADR-0008. The Home dashboard therefore awaits today and tomorrow intent evaluation and
uses cancellation guards so stale user/date/goals/check-in/settings results cannot
replace newer state. Unanswered or skipped adherence receives no credit; modified
sessions are matched approximately by recorded modality and duration until per-session
load logging exists.
