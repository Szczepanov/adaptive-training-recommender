# Evidence Pack — Taper + Fueling

**Date:** 2026-08-30
**Status:** Implemented as an SKR3 evidence migration; recommendation behavior intentionally unchanged.

## Decision questions

1. Which pre-event taper principles are sufficiently established to become reusable sports-knowledge claims, and which exact app taper windows/targets remain product calibration?
2. Which endurance-fueling principles should be available to future prescriptions without pretending the current engine already has fueling decision authority?

## Evidence appraisal

The taper review prioritized endurance-specific systematic reviews/meta-analyses. Fueling used a large acute-carbohydrate meta-analysis, recognized sports-nutrition guidance, two contemporary 2026 reviews of higher carbohydrate intake and the international exercise-associated hyponatremia consensus. The review kept intervention efficacy separate from practical dose guidance and from safety boundaries.

A specific 2026 update was important because current elite endurance practice increasingly experiments with >90 g/h carbohydrate intake. Contemporary reviews support greater carbohydrate oxidation at some higher intakes in trained athletes, but do **not** establish a general performance advantage above the established <=90 g/h framework. A June 2026 Sports Medicine current-opinion review focused specifically on ultra-high intake likewise concludes that broad >90 g/h recommendations are premature, particularly for amateur/recreational athletes. The registry therefore keeps 30-60 / up-to-90 g/h as contextual practice guidance and records >90 g/h as an emerging, athlete-specific boundary rather than silently treating current elite practice as validated universal dosing.

## Taper

### Evidence

**Wang et al., 2023 — endurance taper systematic review/meta-analysis**
PMID 37163550; PMCID PMC10171681; DOI `10.1371/journal.pone.0282838`.

Fourteen studies were included. Time-trial and time-to-exhaustion performance improved after tapering. Subgroup analyses supported reducing training volume by roughly 41-60% while maintaining intensity/frequency, with effective tapers observed across <=7, 8-14 and 15-21 day windows. The authors concluded that a progressive volume reduction over <=21 days is effective on average.

**Bosquet et al., 2007 — taper meta-analysis**
PMID 17762369; DOI `10.1249/mss.0b013e31806010e0`.

Across 27 studies, the best average strategy was approximately two weeks with an exponential 41-60% volume reduction and no reduction in training intensity or frequency.

### Scientific claim

`performance.taper.endurance.pre_event_volume_reduction`

The registered claim supports a substantial pre-event reduction in training volume while meaningful intensity is preserved, generally without sharply reducing frequency. It records the commonly effective 41-60% and <=21-day ranges while explicitly rejecting those averages as universal per-event boundaries.

### Product claims

Exact current app behavior remains separately registered as heuristic policy:

- `policy.taper.windows_volume_v1`: cycling-A race-week-Monday/three-day-minimum logic, A/B 14/5-day fallbacks, intensityScale 1.0 and linear volumeScale toward 0.6;
- `policy.taper.pre_event_restrictions_v1`: current 1-3 / 1-2 / 3-7 day blocks for strength, hard and exhaustive work;
- `policy.taper.sharpening_targets_v1`: current internal sharpening/strength-primer target values.

The evidence supports the concepts of fatigue reduction and preserved quality, not those exact internal numbers.

### Important inventory boundary

`periodization.taper_windows_volume` currently bundles two different policies:

1. **pre-event taper**, for which this pack now has direct scientific + product-policy lineage;
2. **post-event recovery**, where an A event receives three days at volume/intensity 0.4.

This PR intentionally does **not** mark that bundled inventory family covered. Doing so would imply the taper meta-analysis validates the post-event recovery rule, which it does not.

A follow-up inventory refactor should split the family into `periodization.pre_event_taper` and `periodization.post_event_recovery`. The former can then become covered by the claims in this pack; the latter should remain explicit research/product-calibration debt. This is an inventory-model change, not a reason to weaken the epistemic boundary inside the evidence pack.

## Fueling

### Carbohydrate efficacy

**Ramos-Campo et al., 2024 — systematic review/meta-analysis/meta-regression**
PMID 37449467; DOI `10.1080/10408398.2023.2233633`.

The analysis included 136 studies and found carbohydrate ingestion during endurance exercise improved performance compared with placebo/control. Benefits were larger as event duration increased. PubMed records the electronic publication date as **2023-07-14**; the final journal issue is 2024, and the registry stores those two facts consistently.

This supports:

`nutrition.endurance.carbohydrate_during_exercise.performance`

The claim is **high-certainty / strong** for the direction that carbohydrate during relevant endurance exercise can improve performance. It deliberately does not turn the pooled result into one universal intake rate.

### Event-scaled carbohydrate dose

**Burke et al., 2011 — carbohydrate training/competition practice framework**
PMID 21660838; DOI `10.1080/02640414.2011.585473`.

The framework recommends scaling intake to event demands: small amounts can help around one hour, approximately 30-60 g/h is appropriate for longer events, and events beyond about 2.5 hours may benefit from intakes up to roughly 90 g/h using multiple transportable carbohydrates.

**Thomas, Erdman & Burke, 2016 — joint sports-nutrition position statement**
PMID 26920240; DOI `10.1016/j.jand.2015.12.006`.

The position statement supports individualized selection, amount and timing of food and fluid across training and competition contexts.

**Morton et al., 2026 — contemporary endurance-carbohydrate review**
PMID 41759826; PMCID PMC13197957; DOI `10.1016/j.tjnut.2026.101442`.

The review explicitly revisits the <=90 g/h framework in light of current practice. It notes that 120 g/h can increase exogenous and whole-body carbohydrate oxidation in some trained athletes, but that the **performance efficacy of doses above 90 g/h is not yet sufficiently substantiated** to support a broad recommendation. It also highlights limited female evidence and the need for ecologically valid research.

**Plews et al., 2026 — focused current opinion on ultra-high carbohydrate intake**
PMID 42258036; DOI `10.1007/s40279-026-02462-z`.

This June 2026 Sports Medicine paper defines ultra-high intake as >90 g/h and audits why such strategies have spread among elite endurance athletes. It finds a mismatch between real-world adoption and direct performance evidence: higher intakes can increase exogenous carbohydrate oxidation, but studies do not show a consistent dose-response performance benefit beyond roughly 60-90 g/h. The authors conclude that broad ultra-high recommendations are premature, especially for amateur/recreational athletes, while acknowledging possible niche use in selected elite athletes or recovery/multistage contexts. Because this is a current-opinion/narrative synthesis rather than a meta-analysis or guideline, the registry uses it as **supporting context**, not primary efficacy evidence.

Together these support:

`nutrition.endurance.carbohydrate_during_exercise.event_scaled_dose`

The practical dose claim is **moderate-certainty / conditional**, not a hard dosing algorithm. Gastrointestinal tolerance, intensity, duration, prior carbohydrate availability and athlete experience remain relevant; high race-day intake should be practiced rather than introduced for the first time during competition.

The updated evidence boundary is deliberate:

- the registry does **not** downgrade the established up-to-90 g/h guidance merely because elite cyclists increasingly report 90-120+ g/h;
- the registry also does **not** claim that 90 g/h is a proven physiological ceiling;
- >90 g/h is represented as a plausible specialist strategy for selected trained athletes, with performance superiority and generalizability still uncertain;
- the newest focused review explicitly argues against copying ultra-high intake as a default gold standard for amateur/recreational athletes.

This prevents a future runtime consumer from turning elite-practice observations into a universal 120 g/h prescription.

### Hydration safety

**Hew-Butler et al., 2015 — Third International Exercise-Associated Hyponatremia Consensus**
PMID 26102445; DOI `10.1097/JSM.0000000000000221`.

The key safety boundary is not “replace every millilitre lost.” Excessive fluid consumption is the principal modifiable behavioral driver of exercise-associated hyponatremia. Fluid strategy must account for sweat rate, environment, duration and individual context without encouraging weight gain from overdrinking.

This supports:

`nutrition.endurance.hydration.avoid_overdrinking`

The claim is **high-certainty / strong / high-safety**. It explicitly rejects one universal mL/h prescription.

## Why fueling does not enter engine coverage

Repository review found no live engine policy that currently decides carbohydrate grams/hour, fluid volume, sodium intake or race fueling. Therefore adding a `fueling` coverage family now would confuse “science available for a future feature” with “science consumed by current recommendation authority.”

The registry claims are reusable building blocks. A future fueling feature should reference these claim IDs and register any exact product translations separately—for example event-duration bins, chosen g/h targets, tolerance caps or hydration prompts.

## Behavior and policy version

No executable recommendation policy is changed in this PR. It does not modify taper timing, taper volume, pre-event eligibility, sharpening targets, post-event recovery, carbohydrate prescriptions or hydration UI/runtime behavior.

`POLICY_VERSION` remains unchanged.

## Tests

Tests verify:

- canonical registry validity;
- stable PMID/PMCID/DOI source identity;
- 41-60% / <=21-day taper evidence without treating exact app windows as scientific;
- exact taper windows/restrictions/sharpening remain heuristic product claims;
- carbohydrate efficacy is separated from event-scaled dose guidance;
- the corrected Ramos-Campo electronic-publication date;
- contemporary 2026 carbohydrate lineage and the explicit >90 g/h uncertainty boundary;
- the focused June 2026 ultra-high-carbohydrate source remains supporting context and explicitly cautions against an amateur/recreational 120 g/h default;
- the hydration safety claim explicitly rejects blanket fluid rates;
- fueling is not inserted into the current engine coverage inventory;
- the still-bundled taper family remains uncovered until pre- and post-event policies are separated.

## Follow-up

The next small registry-maintenance step should split `periodization.taper_windows_volume` into pre-event taper and post-event recovery coverage families. That will allow the pre-event half to consume this pack honestly without falsely granting evidence authority to the post-event 0.4/0.4 recovery rule.

The high-safety subjective/injury evidence backlog remains separate and unresolved; this pack does not reduce that debt.
