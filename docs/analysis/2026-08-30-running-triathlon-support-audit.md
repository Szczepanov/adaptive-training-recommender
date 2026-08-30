# Running + triathlon athlete support audit (2026-08-30)

## Question

Can the app honestly support an athlete training for 5K, 10K, half marathon, marathon, and short-to-middle-distance triathlon?

## Pre-change answer

**Running: partial. Triathlon: no, not as a native three-discipline coach.**

The repository already had 5K, 10K, half-marathon, and marathon event presets, plus Sprint, Olympic, 70.3, and Iron-distance triathlon labels. But the executable model did not contain a Swimming modality, triathlon sport-specific exposure was defined as Cycling + Running only, Garmin swims were collapsed into Cross Training, and there was no bicycle or pool-access feasibility gate. The running catalog also topped out at generic roughly 30-60 minute easy/tempo/interval sessions, so half-marathon/marathon event metadata did not create a long-run requirement.

That mismatch is more dangerous than simply lacking a feature: the UI could express "Swimming" as an enjoyed modality while the engine could not honor it, and outdoor bike workouts could remain feasible when no bicycle had ever been declared.

## Changes in this PR

### 1. Hard feasibility for sport access

- Adds `outdoor_bike` and `swim_access` to training settings.
- Historical settings without those additive fields parse safely as **false** rather than inventing access.
- Every outdoor Cycling catalog template requires `outdoor_bike`.
- Every Swimming template requires `swim_access`.
- Rapid onboarding asks these independently of gym tier: a "full gym" does not imply ownership of a bicycle or reliable pool access.

### 2. Swimming becomes a first-class modality

- Adds `Swimming` to the executable session vocabulary and `swimming` to external-plan gating.
- Adds technique, easy-aerobic, and sustained-interval swim templates.
- Classifies Garmin swim activities as Swimming rather than Cross Training and gives Swimming its own conservative load/stimulus fallback tables.
- Aligns injury, preference-unavailability, activity-override, and Firestore validation with the modality.

### 3. Triathlon requires all three disciplines

For a triathlon governing event, the demand-derived weekly objectives now include one aerobic exposure scoped independently to Swimming, Cycling, and Running. A week of cycling can no longer fully satisfy "triathlon aerobic base" simply because cycling carries a generic aerobic stimulus.

The deprecated free-text history fallback was also tightened: a modality-scoped objective only receives legacy keyword credit when the activity text actually identifies the allowed modality. This prevents one old "easy endurance" record from crediting swim + bike + run at the same time.

### 4. Running race specificity

- 5K/10K demand gets a race-pace-specific running objective/session in the specific build window.
- Half marathon and marathon demand gets a long-run durability objective and a 60-180 minute long-run template, still capped by the athlete's time budget and planned dose.
- Running taper receives a short sharpening template/objective instead of relying only on generic sessions.
- Primary-discipline specificity is explicit where substitution would be harmful: running/cycling race-specific objectives are modality-scoped, while the generic single-sport aerobic-base objective intentionally remains cross-training-creditable. Triathlon uses separate swim/bike/run aerobic objectives because one generic aerobic bucket would otherwise let a single discipline satisfy the whole multisport requirement.

### 5. Distance naming is made explicit

Polish fractional triathlon nomenclature is not treated as an alias for World Triathlon nomenclature:

- 1/8: 475 m swim / 22.5 km bike / 5.25 km run.
- 1/4: 950 m / 45 km / 10.55 km.
- Sprint remains a distinct preset (World Triathlon commonly 750 m / 20 km / 5 km).
- Olympic/Standard remains 1.5 km / 40 km / 10 km.
- 1/2 / 70.3 is labeled 1.9 km / 90 km / 21.1 km.

This avoids the tempting but wrong product shortcut "1/4 = Olympic".

## Research basis and interpretation

- World Triathlon competition rules / age-group material use 750 m / 20 km / 5 km for Sprint and 1.5 km / 40 km / 10 km for Standard.
  - https://triathlon.org/age-group
- Polish race series use the fractional convention 1/8 = 475 m / 22.5 km / 5.25 km and 1/4 = 950 m / 45 km / ~10.5 km; 1/2 uses 1.9 km / 90 km / 21.1 km.
  - https://ligatriathlonu.pl/dystans-1-8-im/
  - https://ligatriathlonu.pl/dystans-1-4-im/
  - https://triathlon-zg.pl/kalendarz/
- A systematic review of distance-running intensity distribution supports the broad pattern of high low-intensity volume plus smaller doses of threshold/high-intensity work; it does **not** justify one rigid universal weekly recipe.
  - https://pubmed.ncbi.nlm.nih.gov/35038601/
- Reviews of cycling-to-running transition show that prior cycling can impair subsequent running in at least some contexts, while exact optimal transition strategies remain mixed. That supports eventually modeling race-specific brick exposure, but not pretending evidence establishes one mandatory brick prescription.
  - https://pubmed.ncbi.nlm.nih.gov/19437186/

## What this PR deliberately does **not** claim

This is a safe native multisport foundation, **not yet full parity with a specialist marathon or triathlon coach**. Remaining work should be explicit rather than hidden behind event labels:

1. **Distance-aware weekly volume progression:** the engine still uses demand-derived objectives rather than a running/triathlon plan builder that grows weekly running distance, long-run duration, swim volume, and bike duration from history and time-to-event.
2. **Brick / transition sessions:** the current single-template modality model cannot represent bike-to-run as one native multi-block multisport session without either abusing Cross Training or extending the session-definition/planner contract.
3. **Swim-specific performance anchors:** no CSS/critical-swim-speed, 100 m pace, stroke-rate, or technique-quality model yet. Swim sessions therefore use RPE/repeat consistency language rather than invented pace targets.
4. **Open-water specificity:** sighting, starts, drafting, wetsuit, currents, and open-water safety/access are not modeled. `swim_access` means a safe usable swim venue, not necessarily open water.
5. **Triathlon discipline-volume allocation:** the three-discipline floor prevents omission, but it does not yet optimize the proportion of weekly load among swim/bike/run by race distance, athlete weakness, or training history.
6. **Running injury-load progression:** adding a long-run template does not by itself constitute an evidence-based mileage-ramp algorithm. Existing readiness/injury gates still apply, but chronic running-load progression deserves its own design.
7. **Beam-search production status:** the Phase 5.1 prototype now reconciles event objectives independently for every forecast branch/date, including branch-local credit memory, prior-exposure backfill, and dynamic dropped-contributor state. Its width-1 / one-candidate parity regression is active again. The beam planner is still an experiment rather than the production replacement for the greedy weekly-role-allocation path, so this PR does not claim full planner equivalence beyond the invariants covered by tests.

## Product support statement after this PR

- **5K / 10K:** native event-directed support is credible at the objective/template level (easy aerobic, threshold/VO2, race specificity, taper), but still demand-derived rather than a complete authored plan.
- **Half marathon / marathon:** materially improved and now includes long-run durability, but should still be described as **adaptive demand-derived support**, not a distance-calibrated marathon plan generator.
- **1/8 / 1/4 / Sprint / Olympic / 1/2-70.3 triathlon:** native three-discipline adaptive support becomes real (swim + bike + run, access-gated), but brick programming, swim pace modeling, and discipline-volume optimization remain follow-up work.

That is the honest boundary: the app can adapt sensible sport-specific sessions without omitting swimming or prescribing unavailable equipment, while future work is still required before marketing it as a fully periodized specialist marathon/triathlon plan builder.
