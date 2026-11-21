# Ledger update — 2026-11-20 (planning)
schema: ledger-export-v1 · exportedAt 2026-11-20T06:12:03Z
states: measured unless noted; source shown per group
window: 2026-11-07…2026-11-20
use: refresh export for starting a new chat — full user context, upcoming sessions for the next 14 days

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
sleepDuration: 7.5h
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
illness_anomaly, illness_risk_symptom, injury_constraint_touches_session, recovery_beyond_baseline: unknown (unavailable) 2026-11-07…2026-11-19 (definition v1)

## Facts
### recovery (daily_recovery_snapshots; garmin)
2026-11-19: sleep 81 (7.5h), rhr 48 bpm, hrv 62 ms (BALANCED), resp 14, bb 70, steps 0 (D-1), stress 25
recovery missing: weightKg, bodyFatPct (missing)

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
linkedResponseIds: resp-1
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
segments (3; type work, conf high; #idx dur power hr/maxHr):
#0 60s 250W —bpm
#1 60s 250W —bpm
#2 60s 250W —bpm
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
segments (3; type work, conf high; #idx dur power hr/maxHr):
#0 60s 250W —bpm
#1 60s 250W —bpm
#2 60s 250W —bpm
missing: maxHr (missing)

### events (competition_outcomes; manual)
#### out-1 (2026-11-15)
sport: cycling
completed: true
placing: 4
missing: fieldSize, elapsedSeconds, distanceM, summary (not_recorded)

## Derived
biometric_baselines: shown in Today above; missing: sleepScore7dAvg, sleepScore28dAvg, sleepScore28dStdev, restingHr7dAvg, restingHr28dAvg, restingHr28dStdev, hrv7dAvg, hrv28dAvg, hrv28dStdev, respiration7dAvg, respiration28dAvg, respiration28dMad (missing)
subjective_baselines: shown in Today above (recordedDays: 7d 0, 28d 0); missing: readiness_recentAvg, readiness_longAvg, readiness_variability, sleepQuality_recentAvg, sleepQuality_longAvg, sleepQuality_variability, fatigue_recentAvg, fatigue_longAvg, fatigue_variability, soreness_recentAvg, soreness_longAvg, soreness_variability, mentalStress_recentAvg, mentalStress_longAvg, mentalStress_variability, motivation_recentAvg, motivation_longAvg, motivation_variability (missing)
not_yet_supported: d_minus_1_step_normalization, rolling_performed_training_load

## User context
note: since, revisions are not_yet_supported (ledger) unless noted
### injuries (training_settings; athlete)
#### injury-001
region: knee
severity: limit
reviewBy: 2026-12-01
note: patellar tendon
missing: restrictedModalities, since (not_recorded); resolvedAt (not_applicable)

### equipment (athlete)
yes: free_weights, indoor_bike · no: cable_machine, treadmill, pullup_bar
missing: outdoor_bike, swim_access (missing)
### environment (athlete)
default: either · max: 60 min weekday
missing: weekendMaxMinutes (not_recorded)
### guardrails (athlete)
active: avoid_overhead_pressing (others false)
### travel (plan_blocks; athlete)
#### block-1 (2026-11-25)
startDate: 2026-11-25
endDate: 2026-11-28
volumeScale: 0.5
intensityScale: 0.8
since: 2026-11-25

### venueRestrictions (fixed_activities; athlete)
#### fx-1 (2026-11-26)
title: Hotel gym
environment: indoor
equipment: free_weights

### availability (fixed_activities+schedule_windows; athlete)
2026-11-21: 06:00–07:30
schedule_window missing: durationMin, fixed, availabilityContextOverride, availabilityOverrideMin, environment, equipment (not_applicable); title (not_recorded)
#### fixed-fx-1 (2026-11-26)
kind: fixed_activity
durationMin: 45 min
title: Hotel gym
fixed: true
availabilityContextOverride: {"environment":"indoor","equipment":&#91;"free_weights"&#93;}
missing: startLocal (missing); endLocal, availabilityOverrideMin, environment, equipment (not_applicable)

### preferences (athlete)
recovery: mixed · timeOfDay: morning · defaultTime: 60 min weekday, 90 min weekend
modalities: preferred: Cycling (none deprioritized/avoided)
missing: unavailableModalities (missing)
### goals (goals; athlete)
goal-1 (2027-04-18): Spring gran fondo [P4, race, endurance]
timing: {"earliestDate":"2027-04-18","latestDate":"2027-04-18","planningDate":"2027-04-18"}
goals missing: description, performanceTarget, targetMetric, targetValue, targetUnit, targetOutcome, eventLifecycle (not_recorded)

### events (goals+intent_blocks; athlete)
#### block-ib-1 (2026-11-17)
title: Base block
startDate: 2026-11-17
endDate: 2026-12-14
missing: lifecycle (not_applicable)
#### goal-goal-1 (2027-04-18)
title: Spring gran fondo
startDate: 2027-04-18
endDate: 2027-04-18
lifecycle: scheduled

### constraints (constraints; athlete)
no_barbell: true [soft, equipment] — No barbell
missing: description (not_recorded)

missing: trainingDislikes (not_yet_supported)

## Coaching history
### planRevisions (external_plan_revisions; adaptive)
#### plan-1@2 (2026-11-10)
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
outcome: dropped
missing: statusHistory (not_yet_supported); title, priority, summary, stepNotes, fallback (not_recorded)
#### plan-1@2:s1 (2026-11-19)
planId: plan-1
revision: 2
sessionId: s1
status: completed
title: Endurance ride
priority: key
summary: Steady Z2 for 60 min
outcome: performed
missing: statusHistory (not_yet_supported); stepNotes, fallback (not_recorded)

### overrides (external_plan_placements + performed_training_occurrences; adaptive)
#### plan-1@2:s2 (2026-11-18)
planId: plan-1
sessionId: s2
kind: dropped
missing: reason (not_yet_supported); step, replacement, executionState (not_applicable)
#### choice:exec-1:choice-1:0 (2026-11-19)
planId: plan-1
sessionId: s1
kind: swapped
reason: Knee felt tight
step: Back Squat
replacement: Goblet Squat
executionState: completed

plannedToPerformed: 1 shown above
