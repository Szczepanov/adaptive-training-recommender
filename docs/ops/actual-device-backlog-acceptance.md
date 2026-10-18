# Actual-device acceptance: assessments, diary and Garmin

Use this checklist for #897, #895, #725/#726 and #919. It records observations;
it does not waive an acceptance gate. Do **A before the 19 October 2026 baseline window**;
B–D can be done during suitable planned sessions. The
[#897 acceptance audit](../analysis/2026-10-12-issue-897-postmerge-acceptance.md)
remains authoritative for baseline collection and later block readout.

## Preparation

- Use the actual phone, browser and installed/PWA mode you will use in the gym. Note model,
  OS/browser version, app URL, build/version shown in More, Warsaw date and start time.
  Merged code does not establish that the deployed app already includes it.
- Start online, signed in, and finish or deliberately skip the daily check-in. Use the same
  browser/profile throughout; do not sign out, clear site data or reinstall during a draft.
- Use actual familiarization/practice observations or a separate test account. Do not enter
  invented results into a real baseline, or record a physical session that never occurred.
- Airplane mode must disable both cellular and Wi-Fi; some phones leave Wi-Fi enabled.
  Record each outcome as pass, fail or not run. A spinner is not successful persistence.
- Keep raw exports and identifiers private. A public issue needs only a redacted result summary.

## A — Assessment draft, reload and offline-save retry (#897)

1. Online, open **More → Testing → Protocols**. Choose the protocol you actually intend to
   use. For this rehearsal, select **Attempt purpose → familiarization**: the default is
   baseline, so change it deliberately. Read the displayed protocol instructions.
2. At **Lock comparison context**, enter the real setup/device/method fields requested by
   that protocol, then select **Confirm lock and start**. Expand **Locked assessment** and
   note the attempt ID, protocol revision and purpose privately.
3. Use the ordinary runner for the actual practice work. Select **Finish Session (…) →
   Finish & Save Session**. Optional effort/fatigue answers can remain unanswered. This
   saves the SessionExecution; the AssessmentAttempt still awaits trial capture.
4. At **Record assessment trials**, enter the actual measured trial values and their real
   success/miss/validity states. If importing WL Analysis or OpenBar files, review the
   proposed rows and explicitly confirm the load units, success/miss and technical validity.
   Do not confirm a file you have not checked.
5. Before saving trials, reload **while online**. Reopen **More → Testing** if necessary.
   Expect the same attempt, trial count/values and setup. Check confirmation controls too;
   if something resets, record exactly which field rather than silently treating it as retained.
6. With that capture form loaded, turn on airplane mode and verify connectivity is off.
   Select **Save assessment trials** once. Expected: either **Saving…** remains pending or
   a save error appears; rows/setup remain visible. **Assessment recorded** must not appear
   as if an unconfirmed offline save had completed.
7. Restore connectivity and leave the same page open. The pending operation may finish by
   itself. If it settles into an error and **Save assessment trials** becomes enabled,
   retry once. Do not repeatedly tap while **Saving…** is still active.
8. Expect **Assessment recorded**. If still pending after roughly a minute, note elapsed
   time and status. Reload online and reopen the same attempt, checking retained rows
   before any retry; do not create a replacement attempt to hide the failure.
9. Select **Done → More → Testing → History**. Verify one familiarization attempt with the
   right protocol/setup/trials. Familiarization must not silently become a baseline benchmark.
   Download **Export physical-capital evidence (JSON)** and **Export history (CSV)** where
   available. A missing row/control is a result to report, not an instruction to create a
   baseline just to make the export appear.
10. Open **More → Data → Activities**. Where canonical workouts are enabled, verify one
    physical occurrence for the execution, with Garmin attached if present. If the canonical
    view or diagnostics controls are missing, record that deployment/configuration limitation.
    Do not change feature flags just to mark acceptance passed.

Pass A only when the original draft survived reload and the same attempt saved after
reconnect, with no duplicate trial/execution. Retention shown only on the original device
is weaker than server persistence: also check History from a second online browser/device
signed into the same account when possible. Do not clear the first device's cache to test it.

For 19 October reacclimation use `familiarization`. On the chosen 21/23/25 October measurement
dates use `baseline` with the actual locked protocol/setup. This software check does not
prescribe additional exercise or change the athlete's battery schedule.

## B — Structured diary under network loss (#895, plus #725/#726)

1. During a suitable actual session, start online via **More → Sessions** and wait for the
   initial execution to be saved. Note its identity privately and the current prescription.
2. While the app stays open, disable connectivity. Log two or three **actually performed**
   sets with distinct real values. Each should appear once; sync should be **queued**, not
   falsely **synced**. Note any long delay or disabled logging control.
3. If testing correction/undo, use a genuine correction or a disposable test record: **Edit
   set → Save**, or **Remove set → Undo** within the displayed undo window. Verify the final
   values/count and preserve evidence of a failure. Do not alter a real record's meaning for
   the test.
4. Type an unsaved value for the next set. Switch **History → Session**; the value must
   remain. Rotate the phone and check that the active controls remain visible without
   horizontal scrolling. With prior completed history, check the dated **Last time** line;
   loading/unavailable history must not be presented as a confirmed absence.
5. Still disconnected, reload the page. This is a separate **cold-offline shell check**.
   Record whether the app opens at all. If it opens, check the same execution, retained
   sets/corrections and exact prescription. A blank shell is a failed/unsupported cold-offline
   launch; it does not by itself prove the queued diary was deleted.
6. Reconnect. If the shell did not load, reload online and return to **More → Sessions**.
   Verify the same execution and all intended rows. Wait for **synced**. No fabricated rest
   timer should resume after reload.
7. Finish the actual session online. Reload, then inspect it from another online browser or
   device. Every final set should exist once, including corrected values; there should be
   one completed execution. Report local retention and server persistence separately.

If anything disappears, stop that acceptance attempt, reconnect and preserve its identity,
remaining rows and error text. Do not delete/recreate the session or clear browser storage.
Storage eviction is a different test and is **not** established by this procedure.

## C — Real Garmin arrival and sticky manual decisions (#895)

1. During a suitable planned session, record the same physical session in Adaptive and on
   Garmin. Record Adaptive completion, Garmin save, Garmin Connect sync and first appearance
   in Adaptive as separate Warsaw times. One observation proves that arrival order only.
2. Open **More → Data → Activities** after Garmin sync, then reload after any detail update.
   For a matched pair expect one canonical workout, both source references, unchanged
   structured exercise/load/reps/warm-up/effort, and Garmin HR/device telemetry alongside it.
3. Open **Source provenance** and **Source diagnostics (8 checks)**. Record missing/unknown
   states. If nothing matched, copy diagnostics and report unmatched/ambiguous evidence;
   do not force-link two different workouts.
4. To test a **manual link**, use a pair you know is the same workout that remains separate.
   Use **Link Garmin…** in **Link watch recording**. After a later real provider sync/update,
   reload Activities: it should stay one occurrence with the manual decision retained.
5. Test **Unlink Garmin source** only on a genuinely incorrect match or controlled disposable
   records. Unlink creates a lasting exclusion: this pair is deliberately not offered for
   automatic/manual re-linking through the normal candidate UI. Do **not** unlink a correct
   baseline pair merely as a reversible experiment. After a later provider update and reload,
   an intentionally unlinked pair should stay separate. Otherwise report this case **not run**.

If no later provider update actually occurred, label the result "survived reload; real re-sync
not yet tested". Do not assume merely waiting exercised ingestion. Real-device and manual-decision
cases stay open until proved or explicitly waived by the owner.

## D — FIT identity feasibility (#919, separate from offline acceptance)

1. Use **More → Data → Activities** for a recent window containing catalog workouts actually
   launched in Adaptive and executed on Garmin. The current view covers seven days ending
   on the loaded local date. If there are no relevant workouts, report "no evaluable sample";
   missing coverage is not evidence that semantic matching is impossible.
2. Select **Copy source diagnostics**. Paste into a private note/file. Report the exported
   window, projection/sweep status, `fitWorkoutIdentityCounts` and
   `unlinkedSameDayFitPairs` objects, plus whether relevant catalog workouts are present.
   Null counts or unreadable/incomplete sources are not zeros. If the button is absent,
   report that deployment/configuration limitation.
3. For the vendor round trip, choose an already-planned **catalog endurance workout with a
   repeat group**, not a strength workout or a manually recreated watch workout. Use
   **Export / Sync → Sync to Garmin Connect**, then your normal Connect-to-watch sync.
   Keep the exported name and step structure unchanged; note the catalog workout ID and
   planned repetition layout privately. If you cannot identify a suitable workout, report
   that before choosing an unrelated workout.
4. Execute that exported workout on Garmin, save and sync normally. Keep the original FIT
   privately (not a screenshot or GPX conversion) and note device/firmware, workout identity,
   repetition count, and any skipped/added steps or manual lap presses. Provide a private
   artifact reference for analysis; you do not need to decode FIT yourself.
5. We must inspect Lap `wkt_step_index` against the export's flattened `messageIndex` order.
   Completing the workout or seeing it in Activities alone does **not** pass this check.
   Relevant complete evidence with zero semantic matches fails the ADR-0051 premise;
   no manifest/ingestion/join implementation starts until both D7 checks pass.

## Return this result summary

```text
Date/time (Warsaw):
Phone / OS / browser version / browser tab or installed PWA:
App URL and displayed build/version:
A: protocol/revision/purpose; online reload retained ___; offline save showed ___;
   reconnect/retry outcome ___; duplicate counts ___; second-device verification ___
B: offline logged ___ sets; corrections/undo ___; tabs retained unsaved input ___;
   cold-offline reload ___; online recovery ___; second-device values/count ___
C: Adaptive completed ___; Garmin saved ___; Connect synced ___; appeared in app ___;
   one/multiple canonical occurrences ___; manual link/unlink/resync cases ___
D: diagnostic window ___; relevant sample present ___; projection/sweep status ___;
   fitWorkoutIdentityCounts ___; unlinkedSameDayFitPairs ___;
   repeat-group device/workout/layout ___; wkt_step_index vs flattened messageIndex order ___;
   original FIT private reference ___
Errors and not-run cases:
Private evidence references (do not paste raw health files or identifiers publicly):
```
