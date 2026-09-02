# PR #328 — Canonical performed-training facts review notes

## Scope

This note records the invariants verified and hardened during review of PR #328 (`feat(engine): introduce canonical performed training facts and dual-read compare`). The PR remains a **shadow/diagnostic layer**: it does not cut production recommendation logic over to canonical facts.

The implementation is downstream of ADR-0034. It consumes active `PerformedTrainingOccurrence` rows and must not re-run source matching or create a second deduplication authority.

## Semantic invariants

### One physical workout, one exposure row

`PerformedTrainingOccurrence` is the canonical identity boundary. A structured execution linked to a Garmin activity produces one `PerformedExposureFact`, not two downstream training events.

Same-day unrelated occurrences remain distinct. Multiplicity is meaningful and must not be collapsed by date or modality alone.

### Structured semantics win; provider telemetry supplements

When a structured execution is attached:

- structured workout identity and catalog-derived role/category are authoritative;
- structured start/end/duration semantics remain authoritative where available;
- provider observations may contribute measured telemetry and generic modality evidence;
- a provider activity cannot overwrite an exact structured workout identity.

If a canonical occurrence carries an unrecognized modality string but the attached provider has a known normalized modality, the known provider modality may safely fill that semantic gap. An `Unknown` normalization must not block better attached-source evidence.

### Exact workout identity is not automatically exact template identity

The workout catalog is not one-to-one with engine templates. For example, `strength_full_body_maintenance_01` intentionally serves both `str_full_01` and `str_full_03`.

Therefore reverse lookup follows a stricter rule:

- `workoutId` remains exact when it comes from the structured execution;
- `templateId` is inferred from `workoutId` only when exactly one engine template resolves to that workout;
- if several templates share the workout, `templateId` remains undefined unless the structured source explicitly supplies it;
- a shared engine category may still be derived when all matching templates agree on that category.

This prevents a downstream fact from becoming more specific than the persisted structured evidence.

### Generic modality is not an exact training role

A generic provider activity such as `strength_training` establishes that strength occurred. It does **not** establish that the workout was `Full-body Strength`.

Likewise, generic cycling establishes cycling exposure. It does **not** establish `Easy Endurance`.

Therefore:

- exact catalog workout identity may populate a safe engine category and exact weekly coverage credit;
- generic modality-only evidence keeps `category` undefined;
- generic strength may emit a `primary_strength` coverage row with `creditKind: none` / `generic_modality_only`, but must not receive exact weekly role credit.

This is important for the motivating failure mode: a recorded generic strength activity should suppress contradictory "no strength happened" logic through broad recency/frequency facts without being upgraded into a specific prescribed workout role it did not prove.

### Legacy strength remains generic unless exact identity exists

A normalized legacy-strength execution contributes high-confidence broad strength evidence, but no exact catalog category or weekly role is invented unless a real exact identity is available.

## Date integrity

Recommendation recency is date-sensitive. A missing performed date must not silently become `1970-01-01` because that converts data-integrity uncertainty into a false historical fact.

The fact derivation resolves local date from canonical `localDate`, performed start time, or provider activity date and fails visibly when none exists. Canonical `localDate` remains authoritative even when an attached provider timestamp/date is midnight-adjacent and differs by a calendar day.

This keeps malformed occurrence data observable during shadow rollout and protects athlete-local recency semantics.

## Dual-read comparison

Count parity is necessary but insufficient. Equal row counts can conceal:

- modality drift (`Strength` vs `Cycling` on the same day);
- local-date drift;
- duplicate/split legacy rows;
- canonical rows with no legacy counterpart.

`compareCanonicalVsLegacyFacts` therefore performs multiset-aware matching:

1. consume exact `date + modality` matches one-for-one;
2. classify same-date leftovers as `modality_mismatch`;
3. classify same-modality leftovers as `date_mismatch`;
4. classify remaining legacy rows as potential split/duplicate rows;
5. classify remaining canonical rows as unmatched by the legacy path.

The comparator intentionally preserves multiplicity rather than reducing events to a set.

This follows general migration-validation practice: row counts are a basic validation, while content/row-level comparison is needed to detect semantic divergence during dual-read/dual-write migration.

References:

- Google Cloud, *Validate your data migration*: https://cloud.google.com/spanner/docs/data-validation
- Google Cloud, *Migrate from Cassandra to Spanner — Validate data to ensure integrity*: https://cloud.google.com/spanner/docs/non-relational/migrate-from-cassandra-to-spanner

## Tests added/strengthened

The PR test suite now explicitly protects:

- provider-only strength remains generic and does not invent a category;
- provider-only cycling does not invent `Easy Endurance`;
- a known provider modality can replace an unrecognized occurrence modality;
- exact structured catalog identity derives the safe catalog/engine category;
- a shared workout does not fabricate one of several possible engine template ids;
- generic legacy strength remains role-agnostic;
- canonical local date survives a midnight-adjacent provider date/timestamp;
- missing performed date fails rather than creating an epoch-date fact;
- same-day active occurrences remain separate facts;
- equal-count modality drift is detected;
- equal-count date drift is detected;
- duplicate multiplicity is detected after exact matches are consumed;
- canonical-only rows are detected.

## Remaining rollout boundary

This PR deliberately does not switch production strength frequency/weekly-role recommendation decisions to canonical facts. The next cutover stage should use shadow comparison results and the broader ADR-0034/cutover-plan test matrix before enabling canonical facts as the production source of truth.

The cutover plan also explicitly allows an occurrence-`updatedAt` watermark as the simple PR1 revision strategy. Material source-edit/late-sync invalidation and the broader legacy-history horizon remain PR4 concerns and are intentionally not pulled into this PR.
