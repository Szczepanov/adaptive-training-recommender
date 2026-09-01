# Training occurrence architecture summary

One physical workout should be represented once.

```text
planned authority            performed source              wearable source
SessionOccurrence --------> SessionExecution ---------┐
                                                      ├─> PerformedTrainingOccurrence
Garmin / future provider -----------------------------┘
                                                               |
                                                               +-> Activities
                                                               +-> completed-training history
                                                               +-> coach evidence (later gated rollout)
```

Key rules:

- `SessionOccurrence` is planning/authority, not the canonical performed-workout record.
- Structured execution is authoritative for known workout semantics and mechanical performance.
- Garmin/provider data is authoritative for measured device telemetry.
- Garmin-recognized sets/reps/weight are fallback/diagnostic when structured execution exists.
- One source may belong to at most one live canonical performed occurrence.
- Ambiguous matches stay separate.
- Manual link/unlink decisions are sticky.
- Routine provider refresh does not silently rematch stable links.
- Full HR traces remain in detailed source telemetry; the occurrence stores references/summaries.
- The occurrence projection is rebuildable derived state.
- Activities cutover happens before and independently from coach/history activation.
- Actual rest requires explicit durable timing events; it must not be inferred from set-completion deltas.
