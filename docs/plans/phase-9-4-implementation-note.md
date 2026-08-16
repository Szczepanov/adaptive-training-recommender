# Phase 9.4 implementation summary

Phase 9.4 supplies prior subjective history at the composition boundary while keeping the accepted ADR-0020 production selector off.

- one validated half-open Firestore range `[D-28, D)`;
- same `parseSubjectiveCheckin` ownership/date/schema parser as the single-day read;
- malformed rows excluded and surfaced as `DataIssue`s;
- sparse/unavailable/invalid-only history yields no baseline, never neutral synthetic observations;
- `computeSubjectiveBaseline` receives only validated prior rows;
- only the derived baseline reaches today's `DailyReadiness`;
- no raw historical health payload is copied into recommendation persistence;
- no tomorrow/week-ahead reuse of today's baseline, because that would have the wrong `historyThroughDateExclusive` boundary;
- production default remains `SubjectiveDriftPolicy = 'off'`, so no `POLICY_VERSION` bump.
