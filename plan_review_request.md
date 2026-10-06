1. **Identify the missing document links in `docs/README.md` and `README.md`:**
   - I have found that `docs/adr/0048-event-taxonomy-and-format-semantics.md` is present but is not listed in `docs/README.md` (under Architecture Decision Records) or in the `README.md` (under Technical Features).
   - `docs/analysis/2026-10-05-event-taxonomy-fitness-race-hyrox.md` is present but not listed in `docs/README.md` under "Reviews & Analysis".
   - `docs/plans/2026-10-05-event-taxonomy-fitness-race-hyrox.md` is present but not listed in `docs/README.md` under "Implementation Plans".
   - `docs/analysis/2026-10-05-issue-895-wp2-wp3-lifecycle-resume.md` is present but not listed in `docs/README.md` under "Reviews & Analysis".
   - `docs/plans/2026-10-05-issue-895-wp2-wp3-lifecycle-resume.md` is present but not listed in `docs/README.md` under "Implementation Plans".

2. **Add ADR-0048 to `README.md`:**
   - Use `replace_with_git_merge_diff` to add `37. **Event Taxonomy and Format Identity (ADR-0048)**: Extended event model for fitness races and format-specific structured coverage without contaminating core adaptation objectives.` to the "Technical Features" section of `README.md`.

3. **Add ADR-0048 to `docs/README.md`:**
   - Use `replace_with_git_merge_diff` to add `* [**ADR-0048: Event Taxonomy and Format Identity**](./adr/0048-event-taxonomy-and-format-semantics.md) — *Proposed.* Extended event model for fitness races and format-specific structured coverage without contaminating core adaptation objectives.` to the "Architecture Decision Records (ADRs)" section of `docs/README.md`.

4. **Add the October 5, 2026 Analysis and Plan documents to `docs/README.md`:**
   - Add `* [**2026-10-05 Event Taxonomy and Fitness Race Support**](./analysis/2026-10-05-event-taxonomy-fitness-race-hyrox.md) — Analysis of extending the event model for fitness races like HYROX, keeping composite execution and format-specific plan requirements bounded.` to "Reviews & Analysis".
   - Add `* [**2026-10-05 Issue #895 WP2/WP3 Lifecycle Resume**](./analysis/2026-10-05-issue-895-wp2-wp3-lifecycle-resume.md) — Investigation into paused/resumed block state transitions and stale plan projection bugs.` to "Reviews & Analysis".
   - Add `* [**Event Taxonomy and Fitness Race Support**](./plans/2026-10-05-event-taxonomy-fitness-race-hyrox.md) — *In progress.* Implementation plan for ADR-0048, adding structured HYROX coverage and exact format identity without creating an independent optimizer.` to "Implementation Plans".
   - Add `* [**Issue #895 WP2/WP3 Lifecycle Resume**](./plans/2026-10-05-issue-895-wp2-wp3-lifecycle-resume.md) — *In progress.* Implementation plan for fixing block state transitions and stale plan projection on resume.` to "Implementation Plans".

5. **Update Scribe Journal:**
   - I will use `run_in_bash_session` to append a new entry to `.jules/scribe.md` noting this recurring issue with new ADRs, Analysis and Plan files not being added to the indexes.

6. **Complete pre-commit steps to ensure proper testing, verification, review, and reflection are done.**
   - Run `pre_commit_instructions` and follow.

7. **Submit the PR:**
   - Create a branch `scribe/index-adr-0048-and-oct-5-docs` and submit with the required PR format.
