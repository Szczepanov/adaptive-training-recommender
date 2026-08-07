# ADR-0009: Training intent is history-seeded

* **Status:** Accepted
* **Date:** 2026-08-07

## Decision

Training intent is derived at evaluation time from periodization plus answered adherence
history. `resolveTrainingIntent` reads prior recommendation records, credits completed
work into the rolling microcycle, replays its external fatigue cost, and combines that
with today's readiness-derived internal strain. No derived objective, fatigue, or phase
state is persisted.

## Consequences

The intent resolver is asynchronous, unlike the original pure week-ahead planner in
ADR-0008. This is necessary so today's recommendation does not restart the weekly plan
on each dashboard load. Unanswered or skipped adherence receives no credit; modified
sessions are matched approximately by recorded modality until per-session load logging
exists.
