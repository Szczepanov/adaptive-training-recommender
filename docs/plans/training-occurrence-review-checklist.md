# Training occurrence final review checklist

Use this immediately before approving the documentation PR or starting implementation.

- [ ] The distinction between `SessionOccurrence` and performed-workout identity is accepted.
- [ ] Structured execution vs Garmin authority boundaries are accepted.
- [ ] Multiple provider recordings are supported by the domain model.
- [ ] Source uniqueness is transactional/idempotent, not best-effort.
- [ ] Ambiguous matches remain separate.
- [ ] Manual decisions are sticky and auditable.
- [ ] Existing auto-links are not silently rematched during normal sync.
- [ ] Provider deletion/revocation semantics are defined.
- [ ] Full HR traces are not duplicated into the canonical document.
- [ ] Canonical state is rebuildable from source data + manual decisions.
- [ ] Firestore rules/indexes are part of PR 1.
- [ ] Shadow mode precedes Activities cutover.
- [ ] Activities cutover precedes coach/history activation.
- [ ] Engine activation has explicit regression tolerances.
- [ ] Performed rest is persisted explicitly rather than inferred.
- [ ] Representative same-day/multi-device/timezone/retry fixtures exist.
- [ ] PR 1 remains persistence/reconciliation-only, with no UI or engine semantic cutover.
