# Phase 9.0 Shadow Block Operations

This runbook prepares and operates the prospective Phase 9.0 comparison in
[`phase-9-0-shadow-mode-and-decision-journal.md`](../plans/phase-9-0-shadow-mode-and-decision-journal.md).
It creates no athlete evidence and does not authorize a recommendation-policy change.

## Evidence boundary

The block needs real daily use. Do not create, edit, delete, infer, or backfill a decision
journal entry, its reveal order, a subjective check-in, adherence, or an actual verdict.
Historical recovery backfill may repair ingestion before a block starts, but it cannot make a
past day blind, complete, or comparable.

The athlete must keep their existing external-AI planning prompt unchanged for the segment.
That daily external loop, plus the athlete's own check-in, verdict, reveal, adherence, and
outcome actions, are owner actions outside this repository. If they are not available, record
that as a block start blocker; do not substitute synthetic data or a different AI workflow.

## Start-of-block preflight

Run these checks with the production operator's existing credentials. Keep any command output
in the private execution packet, not in a commit, issue, or public analysis. The commands are
bounded to aggregate configuration or a finite date window and must never be changed to dump
Firestore documents, raw payloads, or free text.

1. Confirm the morning Scheduler job is the intended polling job and timezone. Record only its
   name, schedule, timezone, target job name, and whether it omits `--force`:

   ```bash
   gcloud scheduler jobs describe garmin-sync-morning-poll --location="${REGION}" \
     --format="yaml(name,schedule,timeZone,httpTarget.uri,httpTarget.body)"
   ```

   The required configuration is `*/15 5-9 * * *` in `Europe/Warsaw`, targeting
   `garmin-sync`. The freshness gate remains `GARMIN_STALENESS_MINUTES`; do not lower or
   bypass it just to make an audit appear cleaner. Use
   [`cloud-run-deployment.md`](./cloud-run-deployment.md) for deployment or remediation.

2. Check the latest bounded job history for operational failures and record a count plus the
   affected Warsaw dates, if any. Do not include log payloads that might contain personal data:

   ```bash
   gcloud logging read \
     "resource.type=cloud_run_job AND resource.labels.job_name=garmin-sync" \
     --freshness=8d --limit=200 --format="value(timestamp,severity)"
   ```

3. Run the read-only 56-day ingestion audit and record its aggregate counters and any missing
   Warsaw dates in the private packet:

   ```bash
   uv run python -m garmin_sync audit --days 56
   ```

   If this command cannot load the configured production user or Firestore credentials, the
   audit is **unavailable**, not zero missing days. Resolve the deployment configuration with
   the owner; do not set an identifier in a shared shell transcript or source file.

4. Only before day 1, and only when the owner intentionally repairs a real ingestion gap, run
   the existing historical repair then repeat the audit:

   ```bash
   uv run python -m garmin_sync backfill --days 56
   uv run python -m garmin_sync audit --days 56
   ```

   Never run `backfill`, `sync --force`, or a journal write to manufacture a block record.
   A repaired day during an already-open segment remains a documented data-quality event.

Open the segment only after the operational packet shows the schedule, the bounded audit, and
the reason a day can be treated as the first segment day. Store the active `POLICY_VERSION`
from the first exported manifest, rather than copying it from source code by hand.

## Daily owner procedure

For each Warsaw-local block day:

1. Complete the normal subjective check-in.
2. Get the external AI's verdict using the unchanged existing prompt and record that verdict
   in **Decision Journal** before revealing the app recommendation whenever possible. The
   optional note is for the later disagreement review; it is not parsed by the application.
3. Reveal the engine recommendation only after the external verdict has been saved. The app
   records the observed ordering; do not describe a post-reveal entry as blind.
4. Complete the usual adherence prompt and, when known, record the actual verdict in the
   evening.

If a step is missed, leave the gap visible. Do not reconstruct it later from memory, logs, or
the external AI conversation.

## Export and gate review

After recording a journal entry, the Decision Journal card can download a 42-day rolling
evidence package. It contains:

* `shadow-evidence_<start>_to_<end>.csv` — day-level evidence needed to inspect every
  disagreement. It omits user identifiers, raw wearable payloads, and check-in notes. The
  athlete's optional decision-journal note is included because it was entered for this review.
* `shadow-evidence_<start>_to_<end>.readout.json` — aggregate-only gate counts, agreement
  counts split by reveal ordering, contiguous stable-policy segments, and data-quality counts.

The export starts two browser downloads from one explicit action. Browsers may ask whether this
site is allowed to download multiple files after the first artifact. Approve that prompt only
for the trusted app origin, then verify that **both** filenames above are present before treating
the package as complete. If either artifact is absent, rerun the export; do not assume the
on-screen status proves that the browser saved both files.

Keep both files in the owner's private evidence location. Do not commit them or send them to
an external AI service unless the owner separately approves that disclosure. The manifest does
not turn incomplete evidence into a pass:

* `gates.pairedVerdictDays` must reach 28.
* `gates.completeSubjectiveCheckins` must reach 21. A partial check-in is not complete.
* `gates.unanchoredDays` must reach 7. `unanchoredPairedVerdictDays` says how many of those
  can actually support blind agreement.
* `sourceQuality.subjectiveCheckins` preserves `AVAILABLE`, `MISSING`, `INVALID`, and
  `UNAVAILABLE` range states. An invalid or unavailable range is a read-quality finding, not
  an empty check-in window.
* Any `dataQuality` count, `unavailableSources` entry, empty day, missing policy version, or
  duplicate row is a reported gap. It must not be silently discarded from an agreement rate.

The manifest creates a new stable-policy segment whenever `policyVersion` changes, is absent,
or a calendar day is missing. Do not pool those segments or make a before/after causal claim.
Each segment carries its own 28/21/7 gate counts. The aggregate `met` flags remain false unless
all three gates are satisfied within one stable segment; two shorter segments never combine into
a qualifying block.
If a decision-affecting policy, equality, replay, or provenance change is unavoidable, end the
segment before deployment and begin a new one afterward.

## 9.0.8 execution packet and readout

When the block closes, the operator provides the private CSV/package plus a short packet with:

* segment start/end dates, active policy version for each segment, scheduler configuration, and
  bounded audit result;
* all three gate counts and every data-quality/unavailable-source finding;
* unchanged external-AI prompt confirmation and any days without a genuinely unanchored entry;
* every disagreement date and its decision-journal note, reviewed without altering the record;
* a dated `docs/analysis/` readout that reports overall, anchored, and unanchored agreement;
  segment-level agreement; directional conservatism; subjective-drift concentration; the
  one-athlete limitation; and one explicit decision: switch, named fix before switch, or do
  not switch.

If any gate fails, the readout must say which one and why. The correct result is an incomplete
evidence segment, not a negative recommendation-policy finding and not permission to backfill
the evidence.
