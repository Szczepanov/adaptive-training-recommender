# ADR-0028: Physiological Identity Attribution and Measurement Trust

* **Status:** Accepted
* **Date:** 2026-08-27
* **Deciders:** Core Engineering Team

---

## Context and Problem Statement

ADR-0027 established source-aware multisource health observations and, during PR #240 review, was strengthened with two identity-integrity decisions:

- `D-MS-IDENTITY` — shared/secondary source observations require identity/session concordance rather than pretending nightly scalar summaries provide biometric authentication;
- `D-MS-PREBASE` — identity/concordance gating must happen before source-specific baseline accumulation.

Those decisions establish the correct ordering. The current implementation also improved from an RHR-only heuristic to include Garmin ↔ Eight Sleep sleep-session overlap and now quarantines off-wrist Eight Sleep data rather than treating it as verified.

The remaining architectural question is how to turn that bounded concordance check into a durable, learnable, replayable identity-attribution capability without conflating genuine physiological novelty with wrong-person data.

The immediate case is Eight Sleep through Google Health:

```text
Garmin Direct
→ personal device normally worn by the authenticated athlete

Eight Sleep via Google Health
→ shared physical surface that can occasionally be used by another household member
```

A technically valid Eight Sleep observation can therefore be attributed to the wrong person. If accepted, it can contaminate source-specific baselines and later recovery/anomaly/fusion decisions.

The current `CoPresenceValidator` is a useful provisional guard but is not a sufficient permanent identity model:

- it uses fixed default thresholds (`60 min` overlap, `10 bpm` paired RHR delta, `14 bpm` off-wrist baseline delta);
- one RHR dimension still carries most physiological identity authority;
- absolute overlap minutes cannot reliably detect sessions where one interval substantially contains another;
- there is no versioned personal cross-source fingerprint;
- the TypeScript baseline API does not itself require identity/eligibility, so ADR-0027's pre-baseline invariant is not type-enforced;
- there is no canonical ternary identity state, manual ground-truth review loop, or passport version in recommendation replay provenance.

This ADR **refines ADR-0027**. It does not replace `D-MS-IDENTITY` or `D-MS-PREBASE`; it defines the model and contracts that make those decisions enforceable and evolvable.

Source analysis:
[`2026-08-27-physiological-identity-passport-and-measurement-trust.md`](../analysis/2026-08-27-physiological-identity-passport-and-measurement-trust.md)

Implementation plan:
[`../plans/physiological-identity-passport-and-measurement-trust.md`](../plans/physiological-identity-passport-and-measurement-trust.md)

---

## Decision Outcome

### D-PID-SEPARATE — Measurement trust has distinct provenance, quality, identity, and physiology layers

The system keeps four questions distinct:

```text
1. provenance
   who/device produced the observation and how it arrived

2. technical quality
   whether the observation is structurally/technically usable

3. identity attribution
   whether a shared-source night belongs to the authenticated athlete

4. physiological interpretation
   what the athlete's state means after identity is sufficiently trusted
```

Therefore:

```text
physiologically unusual != NOT_USER
technically valid       != USER
provider=eight_sleep    != USER
```

ADR-0025 anomaly/possible-illness logic remains downstream. A genuine athlete night can be both `USER` and physiologically anomalous.

### D-PID-ROLE — Sources have configurable measurement-trust roles

Identity evidence uses source roles independent of ADR-0027 provider/transport provenance.

Initial conceptual roles are:

```text
PERSONAL_DEVICE_ANCHOR
SHARED_PHYSIOLOGY_SOURCE
```

For the current deployment:

```text
provider=garmin, transport=garmin_direct
→ PERSONAL_DEVICE_ANCHOR

provider=eight_sleep, transport=google_health
→ SHARED_PHYSIOLOGY_SOURCE
```

This role assignment is based on current live-account behaviour, where Garmin was available on all 60 audited nights and Eight Sleep on 42/60, plus the operational fact that Garmin is normally worn by the athlete while Eight Sleep is a shared surface.

The role is configurable policy, not a universal statement about every future Garmin or mattress integration. It provides corroboration, not cryptographic authentication.

### D-PID-TERNARY — Canonical identity state is USER / NOT_USER / UNCERTAIN

The shared-source identity contract is:

```text
USER
NOT_USER
UNCERTAIN
```

`UNCERTAIN` is a first-class abstention result.

V1 automation is intentionally asymmetric:

- strong independent multi-feature concordance may automatically produce `USER`;
- missing anchor, conflicting evidence, insufficient passport maturity, or suspected mixed occupancy produces `UNCERTAIN`;
- automatic `NOT_USER` remains disabled until labelled prospective evidence supports it;
- explicit user confirmation may produce `NOT_USER` immediately.

The system is not required to automate `NOT_USER` later if USER/UNCERTAIN automation plus manual correction provides a better risk/complexity trade-off.

### D-PID-PASSPORT — Identity is represented by a versioned Physiological Identity Passport

A **Physiological Identity Passport** models expected source-specific and cross-source relationships for one authenticated user.

It is not a fixed “normal physiology range.”

The passport contains conceptually:

```text
version metadata
trusted-anchor policy
source-specific supporting fingerprints
cross-source relationship distributions
calibration/evidence metadata
```

For Eight Sleep ↔ Garmin, candidate relationship features include:

```text
session start delta
session end delta
duration delta
session intersection / union
Eight Sleep overlap fraction
Garmin overlap fraction
Eight Sleep RHR - Garmin RHR
Eight Sleep respiration - Garmin respiration
log(Eight Sleep HRV) - log(Garmin HRV)
```

V1 uses robust personal estimators such as median, scaled MAD, IQR, and sample count. Per-feature minimum scale floors prevent near-zero historical dispersion from producing unstable evidence scores.

### D-PID-RELATIONAL — Paired relationships outrank absolute physiological ranges

The passport primarily asks whether two independently observed nights relate in the athlete's usual way.

A source-specific Eight Sleep RHR/respiration/HRV profile may provide supporting evidence, but it cannot independently establish `USER` when the personal-device anchor is absent.

This preserves the distinction between:

```text
identity mismatch
vs
real athlete physiological novelty
```

A real athlete may leave the usual absolute RHR/HRV range while Garmin and Eight Sleep still move together.

### D-PID-HRV — Cross-provider HRV equality is not assumed

Equal units do not imply equal acquisition semantics.

The identity model does not require:

```text
Eight Sleep HRV == Garmin HRV
```

It learns a paired relationship, initially using log-space residuals where valid, while ADR-0027 continues to require source-specific physiological baselines.

Raw cross-device HRV averaging remains prohibited unless a future evidence-backed ADR chooses and validates a specific estimator.

### D-PID-TIME — Session geometry uses more than absolute overlap duration

Absolute overlap minutes are useful but insufficient.

Identity feature extraction must be capable of representing:

```text
start delta
end delta
duration delta
intersection / union (Jaccard)
shared-source overlap fraction
anchor overlap fraction
```

This catches cases where an Eight Sleep session substantially contains the athlete's Garmin sleep interval, which may indicate partial/mixed occupancy despite large absolute overlap.

Exact scoring remains evidence-gated by the implementation plan.

### D-PID-NIGHT — Identity attribution is at source-night/session level

Identity applies to the shared-source nightly/session bundle, not independently to each scalar metric.

Prefer:

```text
Eight Sleep source-night = USER
```

rather than:

```text
RHR = USER
HRV = UNCERTAIN
respiration = USER
```

Metric-specific technical quality remains independent and may differ within the same night.

Every persisted assessment references the exact observation bundle id/revision/source-payload hash used.

### D-PID-MIXED — Aggregate mixed occupancy is quarantined, not de-mixed

The current Google Health route provides nightly summary physiology and session timing, not raw/epoch-level Eight Sleep physiology or occupancy transitions.

If evidence suggests partial/mixed occupancy:

```text
identity = UNCERTAIN
→ preserve the raw/shared-source bundle
→ exclude the complete Eight Sleep nightly aggregate from recovery/baseline/passport-positive learning
→ use trusted fallback evidence when available
```

The system must not invent an athlete-only RHR/HRV/respiration value from a potentially mixed nightly aggregate.

A future epoch-level source can revisit segmentation under a separate decision.

### D-PID-PREBASE — ADR-0027 pre-baseline gating becomes an enforceable typed eligibility contract

ADR-0027 already requires identity/concordance before baseline accumulation. ADR-0028 requires the implementation boundary to make that rule explicit rather than relying on callers to remember it.

Pipeline:

```text
raw/source-aware observation
→ technical quality
→ source-night pairing
→ identity assessment
→ explicit observation eligibility
→ source-specific baseline
→ physiological interpretation
→ multisource fusion
→ recommendation
```

Baseline code must either:

```text
A. accept only an already-typed eligible projection
```

or:

```text
B. require identity assessments/eligibility as an explicit input
```

A shared-source `UNCERTAIN` or `NOT_USER` night must be structurally unable to enter source-specific baseline learning through an ordinary supported call path.

### D-PID-ELIG — Downstream authority is explicit and separate from identity state

Identity assessment produces explicit eligibility flags:

```text
display
recovery
baselineLearning
passportLearning
```

Default v1 policy:

| Effective identity | Display | Recovery | Baseline learning | Positive passport learning |
|---|---:|---:|---:|---:|
| manual `USER` | yes | yes | yes | yes |
| high-confidence automatic `USER` | yes | yes | yes after activation gate | initially conservative |
| `UNCERTAIN` | yes, badged | no | no | no |
| `NOT_USER` | audit/history or badged display | no | no | no |

Raw observations remain preserved regardless of eligibility.

### D-PID-ANCHOR-MISSING — Missing anchor is missing evidence

When a shared-source observation exists but the configured personal-device anchor is absent:

```text
shared source present + anchor absent
→ UNCERTAIN unless manually confirmed
```

The system must not infer `NOT_USER`, and physiological similarity to the user's baseline is not sufficient to infer `USER`.

This codifies the fail-closed direction already adopted by the latest PR #240 `UNVERIFIED_OFF_WRIST` behaviour.

### D-PID-LEARN — Passport learning is stricter than same-day recovery use

The passport must resist self-contamination.

Positive passport training evidence is limited to independently verified or stricter trusted-USER observations.

Initial policy:

- manual `USER` may update the positive passport corpus;
- robust central-core history may seed passport v0 under a documented bootstrap;
- merely probable/uncertain records do not recursively train the model;
- manual `NOT_USER` records may populate a negative evaluation/training corpus but never positive passport learning.

The exact automatic passport-learning threshold is a later evidence decision.

### D-PID-MANUAL — Suspicious-night review is append-only ground truth

When a night is `UNCERTAIN` and user action can change authority, the UI offers:

```text
It was me | Not me | Unsure
```

Semantics:

- `It was me` appends a manual `USER` review event;
- `Not me` appends a manual `NOT_USER` review event;
- `Unsure` preserves `UNCERTAIN` and never forces a guess.

The original automatic assessment remains immutable/replayable.

User-facing wording uses “unverified” or “discrepant,” not “imposter” or “bad sensor,” because a technically correct measurement may simply belong to another sleeper.

### D-PID-SCORE — Identity score is not a probability until calibrated

V1 may emit:

```text
identityScore
confidenceTier
reasonCodes
```

The scalar is an evidence/ranking score, not `P(USER)` or a percentage probability until calibration against representative labelled USER/NOT_USER data demonstrates that interpretation.

Feature composition and acceptance thresholds are versioned by `policyVersion` and chosen from replay/prospective false-acceptance vs coverage evidence.

Current fixed `10/14 bpm` and `60 min` constants are provisional guards, not permanent calibrated identity thresholds.

### D-PID-VERSION — Passport and identity policy are versioned and replayable

Every identity assessment records at least:

```text
source-night key
provider
transport
identity status
identity score/tier
reason codes
eligibility
passport version
identity policy version
assessment timestamp
observation bundle id/revision/source payload hash
manual review linkage when present
```

Passport versions are immutable snapshots or deterministically rebuildable from versioned training inputs.

Material device/provider/algorithm discontinuities create a new passport version/era rather than silently mutating one eternal fingerprint.

ADR-0010 recommendation audit must be able to reconstruct why a shared-source observation was admitted, quarantined, or superseded by a fallback source at decision time.

### D-PID-PRIVACY — Do not identify other household members

The target remains only:

```text
USER | NOT_USER | UNCERTAIN
```

The system does not classify named or relational household identities such as spouse, child, or guest.

That information does not improve the current recovery-integrity objective and would expand privacy/data requirements unnecessarily.

### D-PID-SCOPE — Physiological Identity Passport is separate from the Athlete Performance Profile

The identity passport is limited to measurement-attribution features and their evidence/versioning.

It does not own:

- FTP/CPET/performance targets;
- HR/power zones;
- strength 1RMs;
- injury constraints;
- training age;
- event goals;
- capacity limits;
- broader coaching preferences.

Those remain in their existing domain models.

### D-PID-LEGACY — CoPresenceValidator remains a provisional compatibility guard

The current `CoPresenceValidator` is useful safety infrastructure and already implements part of ADR-0027. It is not the final domain model.

Its fixed defaults and combined status vocabulary are provisional:

```text
CONCORDANT / VERIFIED
DISCORDANT_SECONDARY / IMPOSTER_REJECTED
UNVERIFIED_OFF_WRIST
NO_SECONDARY_DATA
```

The target canonical contract becomes ternary identity + independent availability/quality + explicit eligibility.

A migration adapter may retain the existing validator while PI work runs in shadow mode, but no new domain logic should treat `verifiedAthlete: boolean` or fixed RHR/timing thresholds as the permanent identity abstraction.

---

## Consequences

### Positive

- Makes ADR-0027's pre-baseline identity invariant structurally enforceable.
- Reduces risk that wrong-person mattress observations poison longitudinal baselines.
- Preserves genuine illness/recovery anomalies instead of treating all unusual physiology as identity failure.
- Uses multiple available paired features rather than a single RHR discrepancy.
- Learns the athlete's actual Garmin ↔ Eight Sleep relationship instead of inventing universal identity cutoffs.
- Makes uncertainty explicit and cheap because Garmin normally remains available.
- Creates prospective labelled evidence through minimal user review.
- Preserves raw observations for audit/replay independently of downstream authority.
- Avoids unnecessary household-member profiling.
- Generalizes to future shared scales, cuffs, mattresses, or household health sensors.

### Negative

- Adds a new model, assessment, eligibility, persistence, and review layer.
- Requires session pairing and cross-source feature extraction.
- Requires passport version/rebuild lifecycle management.
- Some genuine Eight Sleep nights will remain `UNCERTAIN` until enough evidence or manual review exists.
- Initial automatic coverage is intentionally lower than an aggressive binary classifier.
- Reliable automatic `NOT_USER` classification is deferred because negative labels are sparse.

---

## Rejected Alternatives

### Keep fixed RHR and overlap thresholds as the permanent identity model

Rejected because the current constants are not personally calibrated and a single physiological deviation can still conflate identity mismatch with genuine physiological novelty.

### Use only absolute sleep-overlap minutes

Rejected because one session can substantially contain another while still having large overlap. Start/end/duration residuals and overlap fractions retain more identity information.

### Trust a shared source because it resembles the athlete's normal physiology

Rejected because physiological similarity is not identity proof; another household member can overlap the range while a genuine athlete can leave it.

### Leave pre-baseline filtering as a caller convention

Rejected because an architectural invariant that the API permits callers to bypass is too fragile for stateful baseline learning.

### Identify specific family members

Rejected because it adds privacy, labels, and modelling complexity without improving the current data-integrity outcome.

### Use physiological anomaly detection as the identity classifier

Rejected because a novel physiological state may be the athlete's real state and is precisely what downstream anomaly logic should observe.

### Build deep-learning/BCG identity from current Google Health summaries

Rejected because published BCG person-identification methods rely on raw bed-vibration features that are not exposed by the current data route.

### De-mix partial-night aggregate physiology

Rejected because nightly summaries do not contain enough information to reconstruct per-person physiology reliably.

### Delete quarantined observations

Rejected because raw provenance, audit, manual correction, and future replay require preservation independent of eligibility.

### Merge Garmin and Eight Sleep raw baselines

Rejected by ADR-0027 and reinforced here: provider measurement processes remain distinct, and the cross-source relationship itself is valuable identity evidence.

---

## Implementation Notes

Canonical plan:
[`../plans/physiological-identity-passport-and-measurement-trust.md`](../plans/physiological-identity-passport-and-measurement-trust.md)

Likely boundaries include conceptually:

```text
identityFeatures.ts
identityPassport.ts
identityAttribution.ts
identityEligibility.ts
identityReviewService.ts
```

Exact file names are not architectural decisions.

Recommended Firestore ownership:

```text
users/{uid}/physiological_identity_passports/current
users/{uid}/physiological_identity_passport_versions/{version}
users/{uid}/health_identity_assessments/{nightKey_provider_transport}
users/{uid}/health_identity_review_events/{eventId}
```

Paths remain governed by ADR-0002. Passport versions and automatic assessment evidence are server-owned. Client writes are limited to constrained user-scoped review events.

This ADR intentionally does not select:

- the final numerical identity-score formula;
- exact feature weights;
- calibrated acceptance thresholds;
- automatic `NOT_USER` thresholds;
- a supervised/one-class classifier family;
- future epoch-level mixed-occupancy segmentation.

Those require PI replay and prospective evidence.

---

## References

### Repository

- ADR-0002 — user-scoped Firestore isolation
- ADR-0010 — decision provenance and audit replay
- ADR-0024 — biometric baseline estimator policy
- ADR-0025 — physiological anomaly and possible-illness signals
- ADR-0027 — source-aware multisource health observations (`D-MS-IDENTITY`, `D-MS-PREBASE`)
- `docs/analysis/2026-08-27-multisource-shadow-study.md`
- `app/src/engine/coPresenceValidator.ts`
- `app/src/engine/multisourceBaselines.ts`
- `app/src/engine/multisourceFusion.ts`
- `app/src/observations/models.ts`
- `src/garmin_sync/google_health_mapper.py`

### External evidence

- Quer G, Gouda P, Galarnyk M, Topol EJ, Steinhubl SR. *Inter- and intraindividual variability in daily resting heart rate and its associations with age, sex, sleep, BMI, and time of year*. PLOS One. 2020. https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0227709
- Garmin. *HRV Status*. https://www.garmin.com/en-US/garmin-technology/health-science/hrv-status/
- *Heart rate variability measurement and influencing factors: Towards the standardization of methodology*. 2024. https://pubmed.ncbi.nlm.nih.gov/39351472/
- Eight Sleep. *The Eight Sleep Pod Heart Rate and Heart Rate Variability Accuracy*. 2023. https://www.eightsleep.com/blog/hrv-accuracy/
- Takahashi K, Tanno Y, Ueno H. *Identification of People in a Household Using Ballistocardiography Signals Through Deep Learning*. Sensors. 2025. https://pubmed.ncbi.nlm.nih.gov/40292805/
- Franc V, Prusa D, Voracek V. *Optimal Strategies for Reject Option Classifiers*. JMLR. 2023. https://www.jmlr.org/papers/v24/21-0048.html
