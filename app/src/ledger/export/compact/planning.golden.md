# Ledger update — 2026-11-20 (planning)
schema: ledger-export-v1 · exportedAt 2026-11-20T06:12:03Z
states: measured unless noted; source shown per group
window: 2026-11-07…2026-11-20

## Today (2026-11-20)
check-in (daily_subjective_checkins; athlete):
readiness: 7 score_1_10 (28d baseline: missing)
sleepQuality: 6 score_1_10 (28d baseline: missing)
fatigue: 3 score_1_10 (28d baseline: missing)
soreness: not_recorded
mentalStress: 3 score_1_10 (28d baseline: missing)
motivation: 8 score_1_10 (28d baseline: missing)
painOrInjury: false
illnessSymptoms: false
unusuallyLimitedTime: false
alreadyTrainedToday: false
notes: Contact me at &#91;redacted&#93;
timeAvailableMin: 60 min
indoorOnly: false
missing: tissueResponses, redFlags, preferredModalityToday, soreness (not_recorded)
recovery (daily_recovery_snapshots; garmin):
sleepScore: 81 (28d baseline: missing)
restingHr: 48 bpm (28d baseline: missing)
hrvOvernightAvg: 62 ms (28d baseline: missing)
respirationAvg: 14 breaths/min (28d baseline: missing)
sleepDurationSec: 27000 s
hrvStatus: BALANCED
bodyBatteryWake: 70 score
totalSteps: 0 steps (D-1)
stressAvg: 25 score
missing: weightKg, bodyFatPct (missing)
flags: illness_anomaly unknown (unavailable; definition v1); illness_risk_symptom unknown (unavailable; definition v1); injury_constraint_touches_session unknown (unavailable; definition v1); recovery_beyond_baseline unknown (unavailable; definition v1)
placements (external_plan_placements; adaptive):
2026-11-20 Openers [support] (planned) plan-1@2:s4
summary: Short activation ride
missing: stepNotes, fallback (not_recorded); statusHistory (not_yet_supported)

## Yesterday (2026-11-19)
Cycling · 60 min · 4/5 work sets (+1 warm-up) · sRPE 6 (source athlete) · executedDefinition: unavailable · planned: Endurance ride (plan-1@2:s1 → occ-1)
detail: copy the session report from History

## Upcoming (2026-11-21…2026-12-04)
placements (external_plan_placements; adaptive):
2026-11-22 Tempo intervals [key] (planned) plan-1@2:s3
summary: 3x10 min at tempo
note: Stay seated
note: Cadence 90
fallback: Easy 45 min spin
missing: statusHistory (not_yet_supported)

## Sources
flag_evaluations: unavailable

## Flags
illness_anomaly: unknown (unavailable) 2026-11-07…2026-11-19 (definition v1)
illness_risk_symptom: unknown (unavailable) 2026-11-07…2026-11-19 (definition v1)
injury_constraint_touches_session: unknown (unavailable) 2026-11-07…2026-11-19 (definition v1)
recovery_beyond_baseline: unknown (unavailable) 2026-11-07…2026-11-19 (definition v1)

## Facts
### recovery (daily_recovery_snapshots; garmin)
#### recovery-2026-11-19 (2026-11-19)
sleepScore: 81 score
sleepDurationSec: 27000 s
restingHr: 48 bpm
hrvOvernightAvg: 62 ms
hrvStatus: BALANCED
respirationAvg: 14 breaths/min
bodyBatteryWake: 70 score
totalSteps: 0 steps (D-1)
stressAvg: 25 score
missing: weightKg, bodyFatPct (missing)

### checkins (daily_subjective_checkins; athlete)
#### checkin-2026-11-19 (2026-11-19)
readiness: 7 score_1_10
sleepQuality: 6 score_1_10
fatigue: 3 score_1_10
mentalStress: 3 score_1_10
motivation: 8 score_1_10
painOrInjury: false
illnessSymptoms: false
unusuallyLimitedTime: false
alreadyTrainedToday: false
notes: Contact me at &#91;redacted&#93;
timeAvailableMin: 60 min
indoorOnly: false
missing: soreness, tissueResponses, redFlags, preferredModalityToday (not_recorded)

### performedTraining (performed_training_occurrences; adaptive)
#### occ-1 (2026-11-19)
status: active
modality: Cycling
startedAt: 2026-11-19T16:00:00Z
endedAt: 2026-11-19T17:00:00Z
durationMin: 60 min
plannedSets: 5 sets
workSets: 4 sets
warmupSets: 1 sets
linkedResponseIds: &#91;"resp-1"&#93;
missing: executedDefinitions (unavailable); structuredEntries (not_yet_supported)

### sessionResponses (session_responses; athlete)
#### resp-1 (2026-11-19)
window: immediate
sourceSession: {"kind":"execution","id":"exec-1","date":"2026-11-19"}
occurrenceId: occ-1
sessionRpe: 6 rpe_0_10
missing: completedFraction, unexpectedFatigue, techniqueNote, note (not_recorded)

### assessments (metric_observations; manual)
#### obs-1@1 (2026-11-18)
metricId: ftp_w
value: 250 W
validity: valid
assessmentAttemptId: attempt-1
attemptState: completed
attemptPurpose: checkpoint
missing: invalidReason (not_applicable)

### bodyComposition (anthropometry_entries; home_anthropometry@1)
#### anthro-1 (2026-11-18)
weightKg: 78.2 kg

### nutrition (nutrition_days; garmin)
#### nutrition-2026-11-18 (2026-11-18)
hasIntakeData: false
adherence: mostly_tracked (source athlete)
missing: energyIntakeKcal, proteinGrams, carbsGrams, fatGrams (not_recorded)
#### nutrition-2026-11-19 (2026-11-19)
energyIntakeKcal: 2800 kcal
proteinGrams: 0 g
carbsGrams: 350 g
fatGrams: 90 g
hasIntakeData: true
missing: adherence (not_recorded, athlete)

### activities (activities; garmin)
truncated: false; totalInWindow: 2; exported: 2
#### act-001 (2026-11-19)
type: cycling
durationMin: 60 min
averageHr: 140 bpm
activityTrainingLoad: 80
intensityTag: moderate
sessionCost: moderate
segmentCountTotal: 3
segmentsTruncated: false
segments: &#91;{"segmentIndex":0,"segmentType":"work","durationSeconds":60,"averagePowerWatts":250,"averageHrBpm":null,"maxHrBpm":null,"evidenceConfidence":"high"},{"segmentIndex":1,"segmentType":"work","durationSeconds":60,"averagePowerWatts":250,"averageHrBpm":null,"maxHrBpm":null,"evidenceConfidence":"high"},{"segmentIndex":2,"segmentType":"work","durationSeconds":60,"averagePowerWatts":250,"averageHrBpm":null,"maxHrBpm":null,"evidenceConfidence":"high"}&#93;
missing: maxHr (missing)
#### act-002 (2026-11-18)
type: cycling
durationMin: 60 min
averageHr: 140 bpm
activityTrainingLoad: 80
intensityTag: moderate
sessionCost: moderate
segmentCountTotal: 3
segmentsTruncated: false
segments: &#91;{"segmentIndex":0,"segmentType":"work","durationSeconds":60,"averagePowerWatts":250,"averageHrBpm":null,"maxHrBpm":null,"evidenceConfidence":"high"},{"segmentIndex":1,"segmentType":"work","durationSeconds":60,"averagePowerWatts":250,"averageHrBpm":null,"maxHrBpm":null,"evidenceConfidence":"high"},{"segmentIndex":2,"segmentType":"work","durationSeconds":60,"averagePowerWatts":250,"averageHrBpm":null,"maxHrBpm":null,"evidenceConfidence":"high"}&#93;
missing: maxHr (missing)

### events (competition_outcomes; manual)
#### out-1 (2026-11-15)
sport: cycling
completed: true
placing: 4
missing: fieldSize, elapsedSeconds, distanceM, summary (not_recorded)

## Derived
### biometric_baselines
definition: Rolling biometric baselines (ADR-0024)
window: 7d,28d
missing: value (not_applicable); sleepScore7dAvg, sleepScore28dAvg, sleepScore28dStdev, restingHr7dAvg, restingHr28dAvg, restingHr28dStdev, hrv7dAvg, hrv28dAvg, hrv28dStdev, respiration7dAvg, respiration28dAvg, respiration28dMad, sleepScore_delta28d, restingHr_delta28d, hrvOvernightAvg_delta28d, respirationAvg_delta28d (missing)
### subjective_baselines (daily_subjective_checkins)
definition: Subjective baseline averages and variability
window: 7d,28d
recentRecordedDays: 0 days
longRecordedDays: 0 days
missing: value (not_applicable); readiness_recentAvg, readiness_longAvg, readiness_variability, sleepQuality_recentAvg, sleepQuality_longAvg, sleepQuality_variability, fatigue_recentAvg, fatigue_longAvg, fatigue_variability, soreness_recentAvg, soreness_longAvg, soreness_variability, mentalStress_recentAvg, mentalStress_longAvg, mentalStress_variability, motivation_recentAvg, motivation_longAvg, motivation_variability, readiness_delta28d, sleepQuality_delta28d, fatigue_delta28d, soreness_delta28d, mentalStress_delta28d, motivation_delta28d (missing)
### d_minus_1_step_normalization
definition: D-1 step normalization (I3, ADR-0003)
window: 7d,28d
missing: value (not_yet_supported)
### rolling_performed_training_load
definition: Rolling performed-training load and exposure ledgers (#813)
window: 7d,28d
missing: value (not_yet_supported)

## User context
### injuries (training_settings; athlete)
#### injury-001
region: knee
severity: limit
reviewBy: 2026-12-01
note: patellar tendon
missing: restrictedModalities, since (not_recorded); resolvedAt (not_applicable); revisions (not_yet_supported, ledger)

### equipment (athlete)
free_weights: true
cable_machine: false
treadmill: false
indoor_bike: true
pullup_bar: false
missing: outdoor_bike, swim_access (missing); since, revisions (not_yet_supported, ledger)
### environment (athlete)
defaultEnvironment: either
weekdayMaxMinutes: 60 min
missing: weekendMaxMinutes (not_recorded); since, revisions (not_yet_supported, ledger)
### guardrails (athlete)
avoid_high_impact: false
avoid_heavy_lower_body: false
avoid_overhead_pressing: true
avoid_heavy_spinal_loading: false
missing: since, revisions (not_yet_supported, ledger)
### travel (plan_blocks; athlete)
#### block-1 (2026-11-25)
startDate: 2026-11-25
endDate: 2026-11-28
volumeScale: 0.5
intensityScale: 0.8
since: 2026-11-25
missing: revisions (not_yet_supported, ledger)

### venueRestrictions (fixed_activities; athlete)
#### fx-1 (2026-11-26)
date: 2026-11-26
title: Hotel gym
environment: indoor
equipment: &#91;"free_weights"&#93;
missing: since, revisions (not_yet_supported, ledger)

### availability (fixed_activities+schedule_windows; athlete)
#### window-win-1 (2026-11-21)
date: 2026-11-21
kind: schedule_window
startLocal: 06:00
endLocal: 07:30
missing: durationMin, fixed, availabilityContextOverride, availabilityOverrideMin, environment, equipment (not_applicable); title (not_recorded); since, revisions (not_yet_supported, ledger)
#### fixed-fx-1 (2026-11-26)
date: 2026-11-26
kind: fixed_activity
durationMin: 45 min
title: Hotel gym
fixed: true
availabilityContextOverride: {"environment":"indoor","equipment":&#91;"free_weights"&#93;}
missing: startLocal (missing); endLocal, availabilityOverrideMin, environment, equipment (not_applicable); since, revisions (not_yet_supported, ledger)

### preferences (athlete)
preferredRecoveryStyle: mixed
defaultWeekdayTimeMin: 60
defaultWeekendTimeMin: 90
preferredTimeOfDay: morning
preferredModalities: &#91;"Cycling"&#93;
deprioritizedModalities: &#91;&#93;
avoidedModalities: &#91;&#93;
missing: unavailableModalities (missing); since, revisions (not_yet_supported, ledger)
### goals (goals; athlete)
#### goal-1 (2027-04-18)
title: Spring gran fondo
domain: endurance
status: active
priority: 4
targetDate: 2027-04-18
eventCategory: race
timing: {"earliestDate":"2027-04-18","latestDate":"2027-04-18","planningDate":"2027-04-18"}
missing: description, performanceTarget, targetMetric, targetValue, targetUnit, targetOutcome, eventLifecycle (not_recorded); since, revisions (not_yet_supported, ledger)

### events (goals+intent_blocks; athlete)
#### block-ib-1 (2026-11-17)
title: Base block
startDate: 2026-11-17
endDate: 2026-12-14
missing: lifecycle (not_applicable); since, revisions (not_yet_supported, ledger)
#### goal-goal-1 (2027-04-18)
title: Spring gran fondo
startDate: 2027-04-18
endDate: 2027-04-18
lifecycle: scheduled
missing: since, revisions (not_yet_supported, ledger)

### constraints (constraints; athlete)
#### no_barbell
label: No barbell
value: true
severity: soft
isActive: true
category: equipment
missing: description (not_recorded); since, revisions (not_yet_supported, ledger)

missing: trainingDislikes (not_yet_supported)

## Coaching history
### planRevisions (external_plan_revisions; adaptive)
#### plan-1@2 (2026-11-10)
planId: plan-1
revision: 2
contentHash: sha256:abc
importedAt: 2026-11-10T08:00:00Z
schema: adaptive-training-recommender/external-plan@6
authorRationale: Build aerobic base first.

### placements (external_plan_placements; adaptive)
#### plan-1@2:s2 (2026-11-18)
planId: plan-1
revision: 2
sessionId: s2
status: dropped
date: 2026-11-18
missing: statusHistory (not_yet_supported); title, priority, summary, stepNotes, fallback (not_recorded)
#### plan-1@2:s1 (2026-11-19)
planId: plan-1
revision: 2
sessionId: s1
status: completed
date: 2026-11-19
title: Endurance ride
priority: key
summary: Steady Z2 for 60 min
missing: statusHistory (not_yet_supported); stepNotes, fallback (not_recorded)

### overrides (external_plan_placements; adaptive)
#### plan-1@2:s2 (2026-11-18)
planId: plan-1
sessionId: s2
kind: dropped
date: 2026-11-18
missing: reason (not_yet_supported)

plannedToPerformed: 1 shown above
