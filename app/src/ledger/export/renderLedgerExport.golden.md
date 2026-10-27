# Ledger export

schemaVersion: ledger-export-v1
exportedAt: 2026-11-20T06:12:03Z
asOfDate (Europe/Warsaw): 2026-11-20
purpose: planning
window: 2026-11-07 to 2026-11-20 (14 days)

## Sources

- daily_recovery_snapshots; state: measured; readAt: 2026-11-20T06:12:00Z; newestObservedOn: 2026-11-20
- daily_subjective_checkins; state: measured; readAt: Not recorded; newestObservedOn: Not recorded
- performed_training_occurrences; state: measured; readAt: Not recorded; newestObservedOn: Not recorded
- session_responses; state: measured; readAt: Not recorded; newestObservedOn: Not recorded
- assessment_attempts; state: measured; readAt: Not recorded; newestObservedOn: Not recorded
- metric_observations; state: measured; readAt: Not recorded; newestObservedOn: Not recorded
- anthropometry_entries; state: measured; readAt: Not recorded; newestObservedOn: Not recorded
- nutrition_days; state: measured; readAt: Not recorded; newestObservedOn: Not recorded
- activities; state: measured; readAt: Not recorded; newestObservedOn: Not recorded
- competition_outcomes; state: measured; readAt: Not recorded; newestObservedOn: Not recorded
- training_settings; state: measured; readAt: Not recorded; newestObservedOn: Not recorded
- plan_blocks; state: measured; readAt: Not recorded; newestObservedOn: Not recorded
- fixed_activities; state: measured; readAt: Not recorded; newestObservedOn: Not recorded
- schedule_windows; state: measured; readAt: Not recorded; newestObservedOn: Not recorded
- preferences; state: measured; readAt: Not recorded; newestObservedOn: Not recorded
- goals; state: measured; readAt: Not recorded; newestObservedOn: Not recorded
- intent_blocks; state: measured; readAt: Not recorded; newestObservedOn: Not recorded
- constraints; state: measured; readAt: Not recorded; newestObservedOn: Not recorded
- external_plan_revisions; state: measured; readAt: Not recorded; newestObservedOn: Not recorded
- external_plan_placements; state: measured; readAt: Not recorded; newestObservedOn: Not recorded
- planned_to_performed; state: measured; readAt: Not recorded; newestObservedOn: Not recorded

## 1. Facts

### recovery

state: measured; source: daily_recovery_snapshots; droppedUndated: 0

#### recovery-2026-11-19

observedOn: 2026-11-19

| Field | Value | Unit | Source | State | Observed on |
| --- | --- | --- | --- | --- | --- |
| sleepScore | 81 | score | garmin | measured | 2026-11-19 |
| sleepDurationSec | 27000 | s | garmin | measured | 2026-11-19 |
| restingHr | 48 | bpm | garmin | measured | 2026-11-19 |
| hrvOvernightAvg | 62 | ms | garmin | measured | 2026-11-19 |
| hrvStatus | BALANCED | Not specified | garmin | measured | 2026-11-19 |
| respirationAvg | 14 | breaths/min | garmin | measured | 2026-11-19 |
| bodyBatteryWake | 70 | score | garmin | measured | 2026-11-19 |
| totalSteps | 0 | steps | garmin | measured | 2026-11-18 |
| stressAvg | 25 | score | garmin | measured | 2026-11-19 |
| weightKg | Not recorded | kg | garmin | missing | 2026-11-19 |
| bodyFatPct | Not recorded | % | garmin | missing | 2026-11-19 |

#### recovery-2026-11-20

observedOn: 2026-11-20

| Field | Value | Unit | Source | State | Observed on |
| --- | --- | --- | --- | --- | --- |
| sleepScore | 81 | score | garmin | measured | 2026-11-20 |
| sleepDurationSec | 27000 | s | garmin | measured | 2026-11-20 |
| restingHr | 48 | bpm | garmin | measured | 2026-11-20 |
| hrvOvernightAvg | 62 | ms | garmin | measured | 2026-11-20 |
| hrvStatus | BALANCED | Not specified | garmin | measured | 2026-11-20 |
| respirationAvg | 14 | breaths/min | garmin | measured | 2026-11-20 |
| bodyBatteryWake | 70 | score | garmin | measured | 2026-11-20 |
| totalSteps | 0 | steps | garmin | measured | 2026-11-19 |
| stressAvg | 25 | score | garmin | measured | 2026-11-20 |
| weightKg | Not recorded | kg | garmin | missing | 2026-11-20 |
| bodyFatPct | Not recorded | % | garmin | missing | 2026-11-20 |

### checkins

state: measured; source: daily_subjective_checkins; droppedUndated: 0

#### checkin-2026-11-19

observedOn: 2026-11-19

| Field | Value | Unit | Source | State | Observed on |
| --- | --- | --- | --- | --- | --- |
| readiness | 7 | score_1_10 | athlete | measured | 2026-11-19 |
| sleepQuality | 6 | score_1_10 | athlete | measured | 2026-11-19 |
| fatigue | 3 | score_1_10 | athlete | measured | 2026-11-19 |
| soreness | Not recorded | score_1_10 | athlete | not_recorded | 2026-11-19 |
| mentalStress | 3 | score_1_10 | athlete | measured | 2026-11-19 |
| motivation | 8 | score_1_10 | athlete | measured | 2026-11-19 |
| painOrInjury | false | Not specified | athlete | measured | 2026-11-19 |
| illnessSymptoms | false | Not specified | athlete | measured | 2026-11-19 |
| unusuallyLimitedTime | false | Not specified | athlete | measured | 2026-11-19 |
| alreadyTrainedToday | false | Not specified | athlete | measured | 2026-11-19 |
| notes | Contact me at &#91;redacted&#93; | Not specified | athlete | measured | 2026-11-19 |
| tissueResponses | Not recorded | Not specified | athlete | not_recorded | 2026-11-19 |
| redFlags | Not recorded | Not specified | athlete | not_recorded | 2026-11-19 |
| timeAvailableMin | 60 | min | athlete | measured | 2026-11-19 |
| indoorOnly | false | Not specified | athlete | measured | 2026-11-19 |
| preferredModalityToday | Not recorded | Not specified | athlete | not_recorded | 2026-11-19 |

#### checkin-2026-11-20

observedOn: 2026-11-20

| Field | Value | Unit | Source | State | Observed on |
| --- | --- | --- | --- | --- | --- |
| readiness | 7 | score_1_10 | athlete | measured | 2026-11-20 |
| sleepQuality | 6 | score_1_10 | athlete | measured | 2026-11-20 |
| fatigue | 3 | score_1_10 | athlete | measured | 2026-11-20 |
| soreness | Not recorded | score_1_10 | athlete | not_recorded | 2026-11-20 |
| mentalStress | 3 | score_1_10 | athlete | measured | 2026-11-20 |
| motivation | 8 | score_1_10 | athlete | measured | 2026-11-20 |
| painOrInjury | false | Not specified | athlete | measured | 2026-11-20 |
| illnessSymptoms | false | Not specified | athlete | measured | 2026-11-20 |
| unusuallyLimitedTime | false | Not specified | athlete | measured | 2026-11-20 |
| alreadyTrainedToday | false | Not specified | athlete | measured | 2026-11-20 |
| notes | Contact me at &#91;redacted&#93; | Not specified | athlete | measured | 2026-11-20 |
| tissueResponses | Not recorded | Not specified | athlete | not_recorded | 2026-11-20 |
| redFlags | Not recorded | Not specified | athlete | not_recorded | 2026-11-20 |
| timeAvailableMin | 60 | min | athlete | measured | 2026-11-20 |
| indoorOnly | false | Not specified | athlete | measured | 2026-11-20 |
| preferredModalityToday | Not recorded | Not specified | athlete | not_recorded | 2026-11-20 |

### performedTraining

state: measured; source: performed_training_occurrences; droppedUndated: 0

#### occ-1

observedOn: 2026-11-19

| Field | Value | Unit | Source | State | Observed on |
| --- | --- | --- | --- | --- | --- |
| status | active | Not specified | adaptive | measured | 2026-11-19 |
| modality | Cycling | Not specified | adaptive | measured | 2026-11-19 |
| startedAt | 2026-11-19T16:00:00Z | Not specified | adaptive | measured | 2026-11-19 |
| endedAt | 2026-11-19T17:00:00Z | Not specified | adaptive | measured | 2026-11-19 |
| durationMin | 60 | min | adaptive | measured | 2026-11-19 |
| executedDefinitions | Not recorded | Not specified | adaptive | unavailable | 2026-11-19 |
| structuredEntries | Not recorded | Not specified | adaptive | not_yet_supported | Not recorded |

### sessionResponses

state: measured; source: session_responses; droppedUndated: 0

#### resp-1

observedOn: 2026-11-19

| Field | Value | Unit | Source | State | Observed on |
| --- | --- | --- | --- | --- | --- |
| window | immediate | Not specified | athlete | measured | 2026-11-19 |
| sourceSession | {"kind":"execution","id":"exec-1","date":"2026-11-19"} | Not specified | athlete | measured | 2026-11-19 |
| occurrenceId | occ-1 | Not specified | athlete | measured | 2026-11-19 |
| sessionRpe | 6 | rpe_0_10 | athlete | measured | 2026-11-19 |
| completedFraction | Not recorded | fraction_0_1 | athlete | not_recorded | 2026-11-19 |
| unexpectedFatigue | Not recorded | Not specified | athlete | not_recorded | 2026-11-19 |
| techniqueNote | Not recorded | Not specified | athlete | not_recorded | 2026-11-19 |
| note | Not recorded | Not specified | athlete | not_recorded | 2026-11-19 |

### assessments

state: measured; source: metric_observations; droppedUndated: 0

#### obs-1@1

observedOn: 2026-11-18

| Field | Value | Unit | Source | State | Observed on |
| --- | --- | --- | --- | --- | --- |
| metricId | ftp_w | Not specified | manual | measured | 2026-11-18 |
| value | 250 | W | manual | measured | 2026-11-18 |
| validity | valid | Not specified | manual | measured | 2026-11-18 |
| invalidReason | Not recorded | Not specified | manual | not_applicable | 2026-11-18 |
| assessmentAttemptId | attempt-1 | Not specified | manual | measured | 2026-11-18 |
| attemptState | completed | Not specified | manual | measured | 2026-11-18 |
| attemptPurpose | checkpoint | Not specified | manual | measured | 2026-11-18 |

### bodyComposition

state: measured; source: anthropometry_entries; droppedUndated: 0

#### anthro-1

observedOn: 2026-11-18

| Field | Value | Unit | Source | State | Observed on |
| --- | --- | --- | --- | --- | --- |
| weightKg | 78.2 | kg | home_anthropometry@1 | measured | 2026-11-18 |

### nutrition

state: measured; source: nutrition_days; droppedUndated: 0

#### nutrition-2026-11-18

observedOn: 2026-11-18

| Field | Value | Unit | Source | State | Observed on |
| --- | --- | --- | --- | --- | --- |
| energyIntakeKcal | Not recorded | kcal | garmin | not_recorded | 2026-11-18 |
| proteinGrams | Not recorded | g | garmin | not_recorded | 2026-11-18 |
| carbsGrams | Not recorded | g | garmin | not_recorded | 2026-11-18 |
| fatGrams | Not recorded | g | garmin | not_recorded | 2026-11-18 |
| hasIntakeData | false | Not specified | garmin | measured | 2026-11-18 |
| adherence | mostly_tracked | Not specified | athlete | measured | 2026-11-18 |

#### nutrition-2026-11-19

observedOn: 2026-11-19

| Field | Value | Unit | Source | State | Observed on |
| --- | --- | --- | --- | --- | --- |
| energyIntakeKcal | 2800 | kcal | garmin | measured | 2026-11-19 |
| proteinGrams | 0 | g | garmin | measured | 2026-11-19 |
| carbsGrams | 350 | g | garmin | measured | 2026-11-19 |
| fatGrams | 90 | g | garmin | measured | 2026-11-19 |
| hasIntakeData | true | Not specified | garmin | measured | 2026-11-19 |
| adherence | Not recorded | Not specified | athlete | not_recorded | 2026-11-19 |

### activities

state: measured; source: activities; droppedUndated: 0

truncated: false; totalInWindow: 2; exported: 2

#### act-001

observedOn: 2026-11-19

| Field | Value | Unit | Source | State | Observed on |
| --- | --- | --- | --- | --- | --- |
| type | cycling | Not specified | garmin | measured | 2026-11-19 |
| durationMin | 60 | min | garmin | measured | 2026-11-19 |
| averageHr | 140 | bpm | garmin | measured | 2026-11-19 |
| maxHr | Not recorded | bpm | garmin | missing | 2026-11-19 |
| activityTrainingLoad | 80 | Not specified | garmin | measured | 2026-11-19 |
| intensityTag | moderate | Not specified | garmin | measured | 2026-11-19 |
| sessionCost | moderate | Not specified | garmin | measured | 2026-11-19 |
| segmentCountTotal | 3 | Not specified | garmin | measured | 2026-11-19 |
| segmentsTruncated | false | Not specified | garmin | measured | 2026-11-19 |
| segments | &#91;{"segmentIndex":0,"segmentType":"work","durationSeconds":60,"averagePowerWatts":250,"averageHrBpm":null,"maxHrBpm":null,"evidenceConfidence":"high"},{"segmentIndex":1,"segmentType":"work","durationSeconds":60,"averagePowerWatts":250,"averageHrBpm":null,"maxHrBpm":null,"evidenceConfidence":"high"},{"segmentIndex":2,"segmentType":"work","durationSeconds":60,"averagePowerWatts":250,"averageHrBpm":null,"maxHrBpm":null,"evidenceConfidence":"high"}&#93; | Not specified | garmin | measured | 2026-11-19 |

#### act-002

observedOn: 2026-11-18

| Field | Value | Unit | Source | State | Observed on |
| --- | --- | --- | --- | --- | --- |
| type | cycling | Not specified | garmin | measured | 2026-11-18 |
| durationMin | 60 | min | garmin | measured | 2026-11-18 |
| averageHr | 140 | bpm | garmin | measured | 2026-11-18 |
| maxHr | Not recorded | bpm | garmin | missing | 2026-11-18 |
| activityTrainingLoad | 80 | Not specified | garmin | measured | 2026-11-18 |
| intensityTag | moderate | Not specified | garmin | measured | 2026-11-18 |
| sessionCost | moderate | Not specified | garmin | measured | 2026-11-18 |
| segmentCountTotal | 3 | Not specified | garmin | measured | 2026-11-18 |
| segmentsTruncated | false | Not specified | garmin | measured | 2026-11-18 |
| segments | &#91;{"segmentIndex":0,"segmentType":"work","durationSeconds":60,"averagePowerWatts":250,"averageHrBpm":null,"maxHrBpm":null,"evidenceConfidence":"high"},{"segmentIndex":1,"segmentType":"work","durationSeconds":60,"averagePowerWatts":250,"averageHrBpm":null,"maxHrBpm":null,"evidenceConfidence":"high"},{"segmentIndex":2,"segmentType":"work","durationSeconds":60,"averagePowerWatts":250,"averageHrBpm":null,"maxHrBpm":null,"evidenceConfidence":"high"}&#93; | Not specified | garmin | measured | 2026-11-18 |

### events

state: measured; source: competition_outcomes; droppedUndated: 0

#### out-1

observedOn: 2026-11-15

| Field | Value | Unit | Source | State | Observed on |
| --- | --- | --- | --- | --- | --- |
| sport | cycling | Not specified | manual | measured | 2026-11-15 |
| completed | true | Not specified | manual | measured | 2026-11-15 |
| placing | 4 | Not specified | manual | measured | 2026-11-15 |
| fieldSize | Not recorded | Not specified | manual | not_recorded | 2026-11-15 |
| elapsedSeconds | Not recorded | s | manual | not_recorded | 2026-11-15 |
| distanceM | Not recorded | m | manual | not_recorded | 2026-11-15 |
| summary | Not recorded | Not specified | manual | not_recorded | 2026-11-15 |

## 2. Derived

### biometric_baselines

definition: Rolling biometric baselines (ADR-0024)

window: 7d,28d

inputs: &#91;&#93;

| Field | Value | Unit | Source | State | Observed on |
| --- | --- | --- | --- | --- | --- |
| value | Not recorded | Not specified | ledger | not_yet_supported | Not recorded |

### d_minus_1_step_normalization

definition: D-1 step normalization (I3, ADR-0003)

window: 7d,28d

inputs: &#91;&#93;

| Field | Value | Unit | Source | State | Observed on |
| --- | --- | --- | --- | --- | --- |
| value | Not recorded | Not specified | ledger | not_yet_supported | Not recorded |

### rolling_performed_training_load

definition: Rolling performed-training load and exposure ledgers (#813)

window: 7d,28d

inputs: &#91;&#93;

| Field | Value | Unit | Source | State | Observed on |
| --- | --- | --- | --- | --- | --- |
| value | Not recorded | Not specified | ledger | not_yet_supported | Not recorded |

## 3. Flags

### illness_anomaly

observedOn: 2026-11-20; evaluatedAt: Not recorded

definitionVersion: Not recorded; sessionRef: Not recorded

active: Not recorded; state: not_yet_supported

threshold: Not recorded; baselineWindow: Not recorded

| Field | Value | Unit | Source | State | Observed on |
| --- | --- | --- | --- | --- | --- |

### illness_risk_symptom

observedOn: 2026-11-20; evaluatedAt: Not recorded

definitionVersion: Not recorded; sessionRef: Not recorded

active: Not recorded; state: not_yet_supported

threshold: Not recorded; baselineWindow: Not recorded

| Field | Value | Unit | Source | State | Observed on |
| --- | --- | --- | --- | --- | --- |

### injury_constraint_touches_session

observedOn: 2026-11-20; evaluatedAt: Not recorded

definitionVersion: Not recorded; sessionRef: Not recorded

active: Not recorded; state: not_yet_supported

threshold: Not recorded; baselineWindow: Not recorded

| Field | Value | Unit | Source | State | Observed on |
| --- | --- | --- | --- | --- | --- |

### recovery_beyond_baseline

observedOn: 2026-11-20; evaluatedAt: Not recorded

definitionVersion: Not recorded; sessionRef: Not recorded

active: Not recorded; state: not_yet_supported

threshold: Not recorded; baselineWindow: Not recorded

| Field | Value | Unit | Source | State | Observed on |
| --- | --- | --- | --- | --- | --- |

## 4. User context

### injuries

state: measured; source: training_settings; droppedUndated: 0

#### injury-001

observedOn: Not recorded

| Field | Value | Unit | Source | State | Observed on |
| --- | --- | --- | --- | --- | --- |
| region | knee | Not specified | athlete | measured | Not recorded |
| severity | limit | Not specified | athlete | measured | Not recorded |
| reviewBy | 2026-12-01 | Not specified | athlete | measured | Not recorded |
| note | patellar tendon | Not specified | athlete | measured | Not recorded |
| restrictedModalities | Not recorded | Not specified | athlete | not_recorded | Not recorded |
| resolvedAt | Not recorded | Not specified | athlete | not_applicable | Not recorded |
| since | Not recorded | Not specified | athlete | not_recorded | Not recorded |
| revisions | Not recorded | Not specified | ledger | not_yet_supported | Not recorded |

### equipment

#### equipment

observedOn: Not recorded

| Field | Value | Unit | Source | State | Observed on |
| --- | --- | --- | --- | --- | --- |
| free_weights | true | Not specified | athlete | measured | Not recorded |
| cable_machine | false | Not specified | athlete | measured | Not recorded |
| treadmill | false | Not specified | athlete | measured | Not recorded |
| indoor_bike | true | Not specified | athlete | measured | Not recorded |
| pullup_bar | false | Not specified | athlete | measured | Not recorded |
| outdoor_bike | Not recorded | Not specified | athlete | missing | Not recorded |
| swim_access | Not recorded | Not specified | athlete | missing | Not recorded |
| since | Not recorded | Not specified | ledger | not_yet_supported | Not recorded |
| revisions | Not recorded | Not specified | ledger | not_yet_supported | Not recorded |

### environment

#### environment

observedOn: Not recorded

| Field | Value | Unit | Source | State | Observed on |
| --- | --- | --- | --- | --- | --- |
| defaultEnvironment | either | Not specified | athlete | measured | Not recorded |
| weekdayMaxMinutes | 60 | min | athlete | measured | Not recorded |
| weekendMaxMinutes | Not recorded | min | athlete | not_recorded | Not recorded |
| since | Not recorded | Not specified | ledger | not_yet_supported | Not recorded |
| revisions | Not recorded | Not specified | ledger | not_yet_supported | Not recorded |

### guardrails

#### guardrails

observedOn: Not recorded

| Field | Value | Unit | Source | State | Observed on |
| --- | --- | --- | --- | --- | --- |
| avoid_high_impact | false | Not specified | athlete | measured | Not recorded |
| avoid_heavy_lower_body | false | Not specified | athlete | measured | Not recorded |
| avoid_overhead_pressing | true | Not specified | athlete | measured | Not recorded |
| avoid_heavy_spinal_loading | false | Not specified | athlete | measured | Not recorded |
| since | Not recorded | Not specified | ledger | not_yet_supported | Not recorded |
| revisions | Not recorded | Not specified | ledger | not_yet_supported | Not recorded |

### travel

state: measured; source: plan_blocks; droppedUndated: 0

#### block-1

observedOn: 2026-11-25

| Field | Value | Unit | Source | State | Observed on |
| --- | --- | --- | --- | --- | --- |
| startDate | 2026-11-25 | Not specified | athlete | measured | 2026-11-25 |
| endDate | 2026-11-28 | Not specified | athlete | measured | 2026-11-25 |
| volumeScale | 0.5 | Not specified | athlete | measured | 2026-11-25 |
| intensityScale | 0.8 | Not specified | athlete | measured | 2026-11-25 |
| since | 2026-11-25 | Not specified | athlete | measured | 2026-11-25 |
| revisions | Not recorded | Not specified | ledger | not_yet_supported | Not recorded |

### venueRestrictions

state: measured; source: fixed_activities; droppedUndated: 0

#### fx-1

observedOn: 2026-11-26

| Field | Value | Unit | Source | State | Observed on |
| --- | --- | --- | --- | --- | --- |
| date | 2026-11-26 | Not specified | athlete | measured | 2026-11-26 |
| title | Hotel gym | Not specified | athlete | measured | 2026-11-26 |
| environment | indoor | Not specified | athlete | measured | 2026-11-26 |
| equipment | &#91;"free_weights"&#93; | Not specified | athlete | measured | 2026-11-26 |
| since | Not recorded | Not specified | ledger | not_yet_supported | Not recorded |
| revisions | Not recorded | Not specified | ledger | not_yet_supported | Not recorded |

### availability

state: measured; source: fixed_activities+schedule_windows; droppedUndated: 0

#### window-win-1

observedOn: 2026-11-21

| Field | Value | Unit | Source | State | Observed on |
| --- | --- | --- | --- | --- | --- |
| date | 2026-11-21 | Not specified | athlete | measured | 2026-11-21 |
| kind | schedule_window | Not specified | athlete | measured | 2026-11-21 |
| startLocal | 06:00 | Not specified | athlete | measured | 2026-11-21 |
| endLocal | 07:30 | Not specified | athlete | measured | 2026-11-21 |
| durationMin | Not recorded | Not specified | athlete | not_applicable | 2026-11-21 |
| title | Not recorded | Not specified | athlete | not_recorded | 2026-11-21 |
| fixed | Not recorded | Not specified | athlete | not_applicable | 2026-11-21 |
| availabilityContextOverride | Not recorded | Not specified | athlete | not_applicable | 2026-11-21 |
| availabilityOverrideMin | Not recorded | Not specified | athlete | not_applicable | 2026-11-21 |
| environment | Not recorded | Not specified | athlete | not_applicable | 2026-11-21 |
| equipment | Not recorded | Not specified | athlete | not_applicable | 2026-11-21 |
| since | Not recorded | Not specified | ledger | not_yet_supported | Not recorded |
| revisions | Not recorded | Not specified | ledger | not_yet_supported | Not recorded |

#### fixed-fx-1

observedOn: 2026-11-26

| Field | Value | Unit | Source | State | Observed on |
| --- | --- | --- | --- | --- | --- |
| date | 2026-11-26 | Not specified | athlete | measured | 2026-11-26 |
| kind | fixed_activity | Not specified | athlete | measured | 2026-11-26 |
| startLocal | Not recorded | Not specified | athlete | missing | 2026-11-26 |
| endLocal | Not recorded | Not specified | athlete | not_applicable | 2026-11-26 |
| durationMin | 45 | min | athlete | measured | 2026-11-26 |
| title | Hotel gym | Not specified | athlete | measured | 2026-11-26 |
| fixed | true | Not specified | athlete | measured | 2026-11-26 |
| availabilityContextOverride | {"environment":"indoor","equipment":&#91;"free_weights"&#93;} | Not specified | athlete | measured | 2026-11-26 |
| availabilityOverrideMin | Not recorded | min | athlete | not_applicable | 2026-11-26 |
| environment | Not recorded | Not specified | athlete | not_applicable | 2026-11-26 |
| equipment | Not recorded | Not specified | athlete | not_applicable | 2026-11-26 |
| since | Not recorded | Not specified | ledger | not_yet_supported | Not recorded |
| revisions | Not recorded | Not specified | ledger | not_yet_supported | Not recorded |

### preferences

#### preferences

observedOn: Not recorded

| Field | Value | Unit | Source | State | Observed on |
| --- | --- | --- | --- | --- | --- |
| preferredRecoveryStyle | mixed | Not specified | athlete | measured | Not recorded |
| defaultWeekdayTimeMin | 60 | Not specified | athlete | measured | Not recorded |
| defaultWeekendTimeMin | 90 | Not specified | athlete | measured | Not recorded |
| preferredTimeOfDay | morning | Not specified | athlete | measured | Not recorded |
| preferredModalities | &#91;"Cycling"&#93; | Not specified | athlete | measured | Not recorded |
| deprioritizedModalities | &#91;&#93; | Not specified | athlete | measured | Not recorded |
| avoidedModalities | &#91;&#93; | Not specified | athlete | measured | Not recorded |
| unavailableModalities | Not recorded | Not specified | athlete | missing | Not recorded |
| since | Not recorded | Not specified | ledger | not_yet_supported | Not recorded |
| revisions | Not recorded | Not specified | ledger | not_yet_supported | Not recorded |

### goals

state: measured; source: goals; droppedUndated: 0

#### goal-1

observedOn: 2027-04-18

| Field | Value | Unit | Source | State | Observed on |
| --- | --- | --- | --- | --- | --- |
| title | Spring gran fondo | Not specified | athlete | measured | Not recorded |
| description | Not recorded | Not specified | athlete | not_recorded | Not recorded |
| domain | endurance | Not specified | athlete | measured | Not recorded |
| status | active | Not specified | athlete | measured | Not recorded |
| priority | 4 | Not specified | athlete | measured | Not recorded |
| performanceTarget | Not recorded | Not specified | athlete | not_recorded | Not recorded |
| targetMetric | Not recorded | Not specified | athlete | not_recorded | Not recorded |
| targetValue | Not recorded | Not specified | athlete | not_recorded | Not recorded |
| targetUnit | Not recorded | Not specified | athlete | not_recorded | Not recorded |
| targetDate | 2027-04-18 | Not specified | athlete | measured | Not recorded |
| targetOutcome | Not recorded | Not specified | athlete | not_recorded | Not recorded |
| eventCategory | race | Not specified | athlete | measured | Not recorded |
| eventLifecycle | Not recorded | Not specified | athlete | not_recorded | Not recorded |
| timing | {"earliestDate":"2027-04-18","latestDate":"2027-04-18","planningDate":"2027-04-18"} | Not specified | athlete | measured | Not recorded |
| since | Not recorded | Not specified | ledger | not_yet_supported | Not recorded |
| revisions | Not recorded | Not specified | ledger | not_yet_supported | Not recorded |

### events

state: measured; source: goals+intent_blocks; droppedUndated: 0

#### block-ib-1

observedOn: 2026-11-17

| Field | Value | Unit | Source | State | Observed on |
| --- | --- | --- | --- | --- | --- |
| title | Base block | Not specified | athlete | measured | 2026-11-17 |
| startDate | 2026-11-17 | Not specified | athlete | measured | 2026-11-17 |
| endDate | 2026-12-14 | Not specified | athlete | measured | 2026-11-17 |
| lifecycle | Not recorded | Not specified | athlete | not_applicable | 2026-11-17 |
| since | Not recorded | Not specified | ledger | not_yet_supported | Not recorded |
| revisions | Not recorded | Not specified | ledger | not_yet_supported | Not recorded |

#### goal-goal-1

observedOn: 2027-04-18

| Field | Value | Unit | Source | State | Observed on |
| --- | --- | --- | --- | --- | --- |
| title | Spring gran fondo | Not specified | athlete | measured | 2027-04-18 |
| startDate | 2027-04-18 | Not specified | athlete | measured | 2027-04-18 |
| endDate | 2027-04-18 | Not specified | athlete | measured | 2027-04-18 |
| lifecycle | scheduled | Not specified | athlete | measured | 2027-04-18 |
| since | Not recorded | Not specified | ledger | not_yet_supported | Not recorded |
| revisions | Not recorded | Not specified | ledger | not_yet_supported | Not recorded |

### constraints

state: measured; source: constraints; droppedUndated: 0

#### no_barbell

observedOn: Not recorded

| Field | Value | Unit | Source | State | Observed on |
| --- | --- | --- | --- | --- | --- |
| label | No barbell | Not specified | athlete | measured | Not recorded |
| value | true | Not specified | athlete | measured | Not recorded |
| severity | soft | Not specified | athlete | measured | Not recorded |
| isActive | true | Not specified | athlete | measured | Not recorded |
| category | equipment | Not specified | athlete | measured | Not recorded |
| description | Not recorded | Not specified | athlete | not_recorded | Not recorded |
| since | Not recorded | Not specified | ledger | not_yet_supported | Not recorded |
| revisions | Not recorded | Not specified | ledger | not_yet_supported | Not recorded |

### trainingDislikes

| Field | Value | Unit | Source | State | Observed on |
| --- | --- | --- | --- | --- | --- |
| trainingDislikes | Not recorded | Not specified | athlete | not_yet_supported | Not recorded |

## 5. Coaching history

### planRevisions

state: measured; source: external_plan_revisions; droppedUndated: 0

#### plan-1@2

observedOn: 2026-11-10

| Field | Value | Unit | Source | State | Observed on |
| --- | --- | --- | --- | --- | --- |
| planId | plan-1 | Not specified | adaptive | measured | 2026-11-10 |
| revision | 2 | Not specified | adaptive | measured | 2026-11-10 |
| contentHash | sha256:abc | Not specified | adaptive | measured | 2026-11-10 |
| importedAt | 2026-11-10T08:00:00Z | Not specified | adaptive | measured | 2026-11-10 |
| schema | adaptive-training-recommender/external-plan@6 | Not specified | adaptive | measured | 2026-11-10 |
| authorRationale | Build aerobic base first. | Not specified | adaptive | measured | 2026-11-10 |

### placements

state: measured; source: external_plan_placements; droppedUndated: 0

#### plan-1@2:s2

observedOn: 2026-11-18

| Field | Value | Unit | Source | State | Observed on |
| --- | --- | --- | --- | --- | --- |
| planId | plan-1 | Not specified | adaptive | measured | 2026-11-18 |
| revision | 2 | Not specified | adaptive | measured | 2026-11-18 |
| sessionId | s2 | Not specified | adaptive | measured | 2026-11-18 |
| status | dropped | Not specified | adaptive | measured | 2026-11-18 |
| date | 2026-11-18 | Not specified | adaptive | measured | 2026-11-18 |
| statusHistory | Not recorded | Not specified | adaptive | not_yet_supported | Not recorded |

#### plan-1@2:s1

observedOn: 2026-11-19

| Field | Value | Unit | Source | State | Observed on |
| --- | --- | --- | --- | --- | --- |
| planId | plan-1 | Not specified | adaptive | measured | 2026-11-19 |
| revision | 2 | Not specified | adaptive | measured | 2026-11-19 |
| sessionId | s1 | Not specified | adaptive | measured | 2026-11-19 |
| status | completed | Not specified | adaptive | measured | 2026-11-19 |
| date | 2026-11-19 | Not specified | adaptive | measured | 2026-11-19 |
| statusHistory | Not recorded | Not specified | adaptive | not_yet_supported | Not recorded |

### overrides

state: measured; source: external_plan_placements; droppedUndated: 0

#### plan-1@2:s2

observedOn: 2026-11-18

| Field | Value | Unit | Source | State | Observed on |
| --- | --- | --- | --- | --- | --- |
| planId | plan-1 | Not specified | adaptive | measured | 2026-11-18 |
| sessionId | s2 | Not specified | adaptive | measured | 2026-11-18 |
| kind | dropped | Not specified | adaptive | measured | 2026-11-18 |
| date | 2026-11-18 | Not specified | adaptive | measured | 2026-11-18 |
| reason | Not recorded | Not specified | adaptive | not_yet_supported | Not recorded |

### plannedToPerformed

state: measured; source: planned_to_performed; droppedUndated: 0

#### plan-1@2:s1:occ-1

observedOn: 2026-11-19

| Field | Value | Unit | Source | State | Observed on |
| --- | --- | --- | --- | --- | --- |
| planId | plan-1 | Not specified | adaptive | measured | 2026-11-19 |
| revision | 2 | Not specified | adaptive | measured | 2026-11-19 |
| sessionId | s1 | Not specified | adaptive | measured | 2026-11-19 |
| date | 2026-11-19 | Not specified | adaptive | measured | 2026-11-19 |
| performedOccurrenceRef | occ-1 | Not specified | adaptive | measured | 2026-11-19 |
