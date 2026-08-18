import type { PlannedDose, Recommendation, TrainingSettings } from '../engine/models.ts';
import { EXERCISES } from './exercises.ts';
import { WORKOUTS } from './catalog.ts';
import type {
  AthletePerformanceProfile,
  DisplayTarget,
  PrescriptionBlock,
  PrescriptionStep,
  StepTarget,
  TargetRole,
  WorkoutBlock,
  WorkoutDefinition,
  WorkoutPrescription,
  WorkoutStep
} from './models.ts';

/** The readiness engine chooses session families; this table makes the detailed
 * execution contract explicit rather than inferring it from a display title. */
const FALLBACK_TEMPLATE_TO_WORKOUT: Record<string, string> = {
  rest_01: 'rest_complete_01',
  mob_01: 'recovery_mobility_tissue_01',
  mob_02: 'recovery_mobility_tissue_01',
  end_easy_01: 'cycling_zone2_standard_01',
  end_easy_02: 'running_easy_continuous_01',
  end_easy_03: 'running_walk_run_01',
  str_upper_01: 'strength_upper_body_trunk_01',
  str_upper_pull_01: 'strength_upper_body_trunk_01',
  str_full_01: 'strength_full_body_maintenance_01',
  str_full_02: 'travel_strength_maintenance_01'
};

const strengthTempos: Record<string, string> = {
  hang_power_clean: '20X1',
  front_squat: '31X1',
  romanian_deadlift: '3111',
  bench_press: '31X1',
  pull_up: '21X1',
  dumbbell_row: '2111',
  goblet_squat: '3111',
  push_up: '3111',
  tibialis_raise: '2111'
};

const exerciseById = new Map(EXERCISES.map((exercise) => [exercise.id, exercise]));

function formatSeconds(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return minutes > 0 && remainder > 0 ? `${minutes}:${String(remainder).padStart(2, '0')} min` : minutes > 0 ? `${minutes} min` : `${seconds} sec`;
}

function formatPace(secondsPerKm: number): string {
  return `${Math.floor(secondsPerKm / 60)}:${String(Math.round(secondsPerKm % 60)).padStart(2, '0')}/km`;
}

function formatDose(step: WorkoutStep): string {
  const repetitions = step.duration.type === 'repetitions' ? `${step.duration.repetitions} reps` : undefined;
  const duration = step.duration.type === 'time' ? formatSeconds(step.duration.seconds) : undefined;
  const distance = step.duration.type === 'distance' ? `${step.duration.meters} m` : undefined;
  const unit = repetitions ?? duration ?? distance ?? 'As needed';
  return step.sets ? `${step.sets} × ${unit}` : unit;
}

const ROLE_LABELS: Record<TargetRole, string> = {
  primary: 'Primary',
  fallback: 'Effort check',
  technique: 'Technique',
  secondary: 'Secondary',
  cap: 'Do not exceed'
};

const STALENESS_THRESHOLD_MS = 56 * 24 * 60 * 60 * 1000; // 56 days

function isStale(measuredAt?: string | null): boolean {
  if (!measuredAt) return false;
  const time = new Date(measuredAt).getTime();
  return !isNaN(time) && Date.now() - time > STALENESS_THRESHOLD_MS;
}

/** Compatibility adapter: Normalizes legacy step.target into canonical targets array */
export function normalizeStepTargets(step: WorkoutStep): StepTarget[] {
  if (step.targets && step.targets.length > 0) return step.targets;
  if (!step.target) return [];

  const target = step.target;
  switch (target.type) {
    case 'rpe':
      return [{ role: 'primary', metric: 'rpe', value: { min: target.min, max: target.max } }];
    case 'ftp_percent':
      return [
        { role: 'primary', metric: 'ftp_percent', value: { min: target.min, max: target.max }, requires: 'power_meter' },
        { role: 'fallback', metric: 'rpe', value: { min: target.min <= 60 ? 1 : target.min <= 75 ? 2 : 4, max: target.max <= 75 ? 3 : 6 } }
      ];
    case 'cadence':
      return [{ role: 'technique', metric: 'cadence', value: { minRpm: target.minRpm, maxRpm: target.maxRpm }, requires: 'cadence_data' }];
    case 'heart_rate_zone':
      return [{ role: 'secondary', metric: 'heart_rate_zone', value: { zone: target.zone }, requires: 'heart_rate_monitor' }];
    case 'reps_in_reserve':
      return [{ role: 'primary', metric: 'reps_in_reserve', value: { min: target.min, max: target.max } }];
    case 'technical_quality':
      return [{ role: 'technique', metric: 'technical_quality', value: target }];
    case 'power_zone':
      return [
        { role: 'primary', metric: 'ftp_percent', value: { min: 56, max: 75 }, requires: 'power_meter' },
        { role: 'fallback', metric: 'rpe', value: { min: 2, max: 3 } }
      ];
  }
}

function resolveStructuredTargets(
  step: WorkoutStep,
  workout: WorkoutDefinition,
  profile?: AthletePerformanceProfile,
  trainingSettings?: TrainingSettings
): { structured: DisplayTarget[]; stringTargets: string[]; stepStopConditions: string[] } {
  const rawTargets = normalizeStepTargets(step);
  const structured: DisplayTarget[] = [];
  const stringTargets: string[] = [];
  const stepStopConditions: string[] = [];

  // Determine tri-state device capabilities
  const powerMeterAvailable = trainingSettings?.capabilities?.powerMeter ?? profile?.capabilities?.powerMeter;
  const hrMonitorAvailable = trainingSettings?.capabilities?.heartRateMonitor ?? profile?.capabilities?.heartRateMonitor;
  const cadenceAvailable = trainingSettings?.capabilities?.cadenceData ?? profile?.capabilities?.cadenceData;

  const cyclingFtp = profile?.cycling?.ftpWatts ?? profile?.ftpWatts;
  const cyclingFtpStale = isStale(profile?.cycling?.measuredAt ?? profile?.measuredAt);

  const cyclingLthr = profile?.cycling?.lthrBpm ?? profile?.lthrBpm;
  const runningLthr = profile?.running?.lthrBpm ?? profile?.lthrBpm;
  const runningPace = profile?.running?.thresholdPaceSecPerKm ?? profile?.thresholdPaceSecPerKm;
  const runningPaceStale = isStale(profile?.running?.measuredAt ?? profile?.measuredAt);

  for (const target of rawTargets) {
    if (target.requires === 'power_meter' && powerMeterAvailable === false) continue;
    if (target.requires === 'heart_rate_monitor' && hrMonitorAvailable === false) continue;
    if (target.requires === 'cadence_data' && cadenceAvailable === false) continue;

    switch (target.metric) {
      case 'rpe': {
        if ('min' in target.value && 'max' in target.value) {
          const val = target.value as { min: number; max: number };
          const text = `RPE ${val.min}–${val.max}/10`;
          structured.push({ role: target.role, label: ROLE_LABELS[target.role], metric: 'rpe', valueText: text });
          stringTargets.push(text);
        }
        break;
      }
      case 'ftp_percent': {
        if (workout.modality !== 'cycling') break; // Never show cycling FTP watts on generic non-cycling sessions
        if ('min' in target.value && 'max' in target.value) {
          const val = target.value as { min: number; max: number };
          const isZone2 = val.min === 56 && val.max === 75;
          const zoneSystemLabel = profile?.cycling?.powerZoneSystem === 'custom'
            ? 'Power Zone 2 — custom FTP zones'
            : 'Power Zone 2 — FTP-based 5-zone system';

          if (cyclingFtp && cyclingFtp > 0 && powerMeterAvailable !== false) {
            const minW = Math.round(cyclingFtp * val.min / 100);
            const maxW = Math.round(cyclingFtp * val.max / 100);
            const valueText = isZone2
              ? `Primary target: FTP-based Zone 2, 56–75% FTP (${minW}–${maxW} W) [${zoneSystemLabel}]`
              : `Power: ${val.min}–${val.max}% FTP (${minW}–${maxW} W)`;

            structured.push({
              role: target.role,
              label: ROLE_LABELS[target.role],
              metric: 'power',
              valueText: cyclingFtpStale ? `${valueText} (Review needed: FTP measured >56d ago)` : valueText,
              rawWatts: { min: minW, max: maxW },
              staleTag: cyclingFtpStale
            });
            stringTargets.push(valueText);
          } else {
            // Power missing or unconfigured: omit watts and rely on RPE fallback
            const relativeText = `${val.min}–${val.max}% FTP (set FTP & power meter in Preferences for W)`;
            if (target.role !== 'primary') {
              stringTargets.push(relativeText);
            }
          }
        }
        break;
      }
      case 'cadence': {
        if ('minRpm' in target.value && 'maxRpm' in target.value) {
          const val = target.value as { minRpm: number; maxRpm: number };
          const text = `Cadence: ${val.minRpm}–${val.maxRpm} rpm`;
          structured.push({ role: target.role, label: ROLE_LABELS[target.role], metric: 'cadence', valueText: text });
          stringTargets.push(text);
        }
        break;
      }
      case 'heart_rate_zone':
      case 'heart_rate_bpm': {
        if (workout.modality === 'cycling') {
          // Cycling HR v1 policy: show only when explicit cycling LTHR/zones exist
          if (cyclingLthr && cyclingLthr > 0) {
            const text = `Cycling HR guardrail: stay within endurance range (below LTHR ${cyclingLthr} bpm)`;
            structured.push({ role: target.role, label: ROLE_LABELS[target.role], metric: 'heart_rate', valueText: text });
            stringTargets.push(text);
          }
        } else if (workout.modality === 'running') {
          if (runningLthr && runningLthr > 0) {
            const text = `Running HR guardrail: stay below LTHR ${runningLthr} bpm`;
            structured.push({ role: target.role, label: ROLE_LABELS[target.role], metric: 'heart_rate', valueText: text });
            stringTargets.push(text);
          }
        }
        break;
      }
      case 'pace': {
        if (workout.modality === 'running' && runningPace) {
          const text = `Threshold pace reference: ${formatPace(runningPace)}`;
          structured.push({
            role: target.role,
            label: ROLE_LABELS[target.role],
            metric: 'pace',
            valueText: runningPaceStale ? `${text} (Review needed: threshold pace measured >56d ago)` : text,
            staleTag: runningPaceStale
          });
          stringTargets.push(text);
        }
        break;
      }
      case 'reps_in_reserve': {
        if ('min' in target.value && 'max' in target.value) {
          const val = target.value as { min: number; max: number };
          const text = `Target RIR: ${val.min}–${val.max} reps in reserve`;
          structured.push({ role: target.role, label: ROLE_LABELS[target.role], metric: 'reps_in_reserve', valueText: text });
          stringTargets.push(text);
        }
        break;
      }
      case 'technical_quality': {
        if ('cue' in target.value) {
          const val = target.value as { cue: string; successCriteria?: string[]; commonFaults?: string[]; stopConditions?: string[] };
          structured.push({ role: target.role, label: ROLE_LABELS[target.role], metric: 'technique', valueText: val.cue });
          stringTargets.push(val.cue);
          if (val.stopConditions) stepStopConditions.push(...val.stopConditions);
        }
        break;
      }
    }
  }

  // Modality-specific contextual fallbacks
  if (workout.modality === 'strength') {
    const estimated1Rm = profile?.strength?.estimated1RmKg?.[step.exerciseId] ?? profile?.estimated1RmKg?.[step.exerciseId];
    if (estimated1Rm) {
      const repetitions = step.duration.type === 'repetitions' ? step.duration.repetitions : undefined;
      const percentage = repetitions && repetitions <= 5 ? [0.70, 0.80] : repetitions && repetitions <= 8 ? [0.60, 0.75] : [0.45, 0.65];
      const minKg = Math.round(estimated1Rm * percentage[0] / 2.5) * 2.5;
      const maxKg = Math.round(estimated1Rm * percentage[1] / 2.5) * 2.5;
      const text = `Starting load: ${minKg}–${maxKg} kg (~${Math.round(percentage[0] * 100)}–${Math.round(percentage[1] * 100)}% e1RM); RIR takes precedence`;
      structured.push({ role: 'secondary', label: ROLE_LABELS.secondary, metric: 'load', valueText: text });
      stringTargets.push(text);
    }
    const tempo = strengthTempos[step.exerciseId];
    if (tempo) {
      const text = `Tempo ${tempo} (lower / pause / lift / pause)`;
      structured.push({ role: 'technique', label: ROLE_LABELS.technique, metric: 'tempo', valueText: text });
      stringTargets.push(text);
    }
  }

  return { structured, stringTargets, stepStopConditions };
}

function toDisplayStep(
  step: WorkoutStep,
  workout: WorkoutDefinition,
  profile?: AthletePerformanceProfile,
  trainingSettings?: TrainingSettings
): PrescriptionStep {
  const exercise = exerciseById.get(step.exerciseId);
  const { structured, stringTargets, stepStopConditions } = resolveStructuredTargets(step, workout, profile, trainingSettings);

  const legacyTechnical = step.target?.type === 'technical_quality'
    ? [
      ...(step.target.successCriteria ?? []).map((criterion) => `Quality: ${criterion}`),
      ...(step.target.commonFaults ?? []).map((fault) => `Avoid: ${fault}`),
      ...(step.target.stopConditions ?? []).map((condition) => `Stop: ${condition}`)
    ]
    : [];

  const allStopConditions = [...stepStopConditions, ...(step.target?.type === 'technical_quality' ? step.target.stopConditions ?? [] : [])];

  return {
    id: step.id,
    name: step.name,
    dose: formatDose(step),
    ...(step.restAfterSec !== undefined ? { rest: `${formatSeconds(step.restAfterSec)} recovery` } : {}),
    targets: stringTargets,
    structuredTargets: structured,
    cues: [exercise?.instruction, ...legacyTechnical, ...(step.notes ?? [])].filter((cue): cue is string => Boolean(cue)),
    ...(allStopConditions.length > 0 ? { stopConditions: allStopConditions } : {}),
    ...(step.optional ? { optional: true } : {})
  };
}

const workoutMapCache = new WeakMap<WorkoutDefinition[], Map<string, WorkoutDefinition>>();

export function workoutForTemplate(templateId: string, workouts: WorkoutDefinition[] = WORKOUTS): WorkoutDefinition | undefined {
  const matching = workouts
    .filter((workout) => workout.status === 'active' && !workout.manualOnly && workout.engineTemplateIds?.includes(templateId))
    .sort((a, b) => (a.engineTemplatePriority ?? 1) - (b.engineTemplatePriority ?? 1));
  if (matching.length > 0) return matching[0];
  const fallbackId = FALLBACK_TEMPLATE_TO_WORKOUT[templateId];
  if (!fallbackId) return undefined;

  let map = workoutMapCache.get(workouts);
  if (!map) {
    map = new Map(workouts.map(w => [w.id, w]));
    workoutMapCache.set(workouts, map);
  }
  const workout = map.get(fallbackId);
  return workout?.status === 'active' ? workout : undefined;
}

function parseSetsFromLabel(label?: string, summary?: string): number | undefined {
  const text = `${label ?? ''} ${summary ?? ''}`;
  const match = text.match(/(\d+)\s*(?:x|sets|rounds|repeats)\b/i);
  if (match) {
    const val = parseInt(match[1], 10);
    if (!isNaN(val) && val > 0 && val <= 20) return val;
  }
  return undefined;
}

function applyDoseScaling(
  blocks: WorkoutBlock[],
  targetDurationMin: number,
  activeDose?: { label?: string; prescriptionSummary?: string; doseRatio?: number },
  direction?: 'easier' | 'harder'
): WorkoutBlock[] {
  if (!activeDose && direction !== 'harder') return blocks;

  const isHarder = direction === 'harder' || (activeDose?.doseRatio !== undefined && activeDose.doseRatio > 1.0);
  if (!isHarder) return blocks;

  const parsedSets = parseSetsFromLabel(activeDose?.label, activeDose?.prescriptionSummary);
  const doseRatio = activeDose?.doseRatio ?? 1.25;

  let nonMainSec = 0;
  for (const block of blocks) {
    if (block.role !== 'main') {
      for (const step of block.steps) {
        if (step.duration.type === 'time') {
          nonMainSec += step.duration.seconds * (step.sets ?? 1);
        }
      }
    }
  }

  const targetMainTotalSec = Math.max(0, targetDurationMin * 60 - nonMainSec);

  return blocks.map((block) => {
    if (block.role !== 'main') return block;

    const mainSteps = block.steps;
    return {
      ...block,
      steps: mainSteps.map((step) => {
        let sets = step.sets;
        let duration = step.duration;

        if (sets !== undefined && sets > 1) {
          sets = parsedSets ?? Math.max(sets + 1, Math.round(sets * doseRatio));
        }

        if (duration.type === 'time' && (step.sets === undefined || step.sets <= 1)) {
          const scaledSec = targetMainTotalSec > 0
            ? Math.max(duration.seconds, targetMainTotalSec)
            : Math.round(duration.seconds * doseRatio);
          duration = { type: 'time', seconds: scaledSec };
        }

        return {
          ...step,
          ...(sets !== undefined ? { sets } : {}),
          duration
        };
      })
    };
  });
}

function applyVariant(workout: WorkoutDefinition, variantId: 'full' | 'reduced' | 'return_to_training'): WorkoutBlock[] {
  const variant = workout.variants.find((item) => item.id === variantId) ?? workout.variants[0];
  const overrides = new Map(variant.stepOverrides.map((override) => [override.stepId, override]));
  return workout.blocks.map((block) => ({
    ...block,
    steps: block.steps.flatMap((step) => {
      const override = overrides.get(step.id);
      if (override?.omit) return [];
      const duration = override?.durationSeconds !== undefined && step.duration.type === 'time'
        ? { type: 'time' as const, seconds: override.durationSeconds }
        : step.duration;
      return [{
        ...step,
        duration,
        ...(override?.sets !== undefined ? { sets: override.sets } : {}),
        ...(override?.restAfterSec !== undefined ? { restAfterSec: override.restAfterSec } : {}),
        ...(override?.target ? { target: override.target } : {}),
        ...(override?.targets ? { targets: override.targets } : {})
      }];
    })
  }));
}

export function variantFor(rec: Recommendation, executionDose?: PlannedDose): 'full' | 'reduced' | 'return_to_training' {
  if (rec.mode === 'recover' && rec.template.category !== 'Rest') return 'return_to_training';
  const manualVariant = rec.adjustment?.direction === 'easier' ? 'reduced' : 'full';
  const dose = executionDose ?? rec.executionDose ?? rec.plannedDose;
  const doseVariant = dose !== undefined && dose.volume <= 0.4
    ? 'return_to_training'
    : dose !== undefined && dose.volume <= 0.7
      ? 'reduced'
      : 'full';
  const conservatism = { full: 0, reduced: 1, return_to_training: 2 } as const;
  return conservatism[manualVariant] >= conservatism[doseVariant] ? manualVariant : doseVariant;
}

export function resolveWorkoutPrescription(
  recommendation: Recommendation,
  userId: string,
  date: string,
  profile?: AthletePerformanceProfile,
  executionDose?: PlannedDose,
  trainingSettings?: TrainingSettings
): WorkoutPrescription | null {
  const workout = workoutForTemplate(recommendation.template.id);
  if (!workout) return null;

  const variantId = variantFor(recommendation, executionDose);
  const variant = workout.variants.find((item) => item.id === variantId) ?? workout.variants[0];

  const rawAdjustedBlocks = applyVariant(workout, variantId);

  const activeDose = recommendation.activeDose;
  const direction = recommendation.adjustment?.direction;
  const targetDurationMin = activeDose?.durationMin ?? (
    direction === 'harder' && variant.targetDurationMin < (recommendation.template.durationMax ?? variant.targetDurationMin)
      ? Math.min(recommendation.template.durationMax, Math.round(variant.targetDurationMin * (activeDose?.doseRatio ?? 1.25)))
      : variant.targetDurationMin
  );

  const adjustedBlocks = applyDoseScaling(rawAdjustedBlocks, targetDurationMin, activeDose, direction);

  const displayBlocks: PrescriptionBlock[] = adjustedBlocks.map((block) => ({
    id: block.id,
    name: block.name,
    role: block.role,
    steps: block.steps.map((step) => toDisplayStep(step, workout, profile, trainingSettings))
  }));

  return {
    id: `${date}_${workout.id}_${variantId}`,
    userId,
    date,
    workoutId: workout.id,
    workoutVersion: workout.version,
    variantId,
    targetDurationMin,
    adjustedBlocks,
    displayBlocks,
    resolvedParameters: Object.fromEntries((workout.parameters ?? []).map((parameter) => [parameter.id, parameter.defaultValue])),
    rationale: [workout.description, variant.rationale],
    adjustmentReasons: recommendation.adjustment ? [recommendation.adjustment.rationale] : [],
    source: { recommendationEngineVersion: 'daily-recommendation-v2' },
    status: 'recommended'
  };
}

export function getPrescriptionLegend(): string {
  return 'RPE is effort out of 10. RIR is repetitions left before failure. Four-part tempo is lower / pause / lift / pause; X means accelerate with control.';
}
