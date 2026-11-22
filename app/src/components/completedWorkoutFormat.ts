/** Pure formatting helpers for `CompletedWorkoutList` cards and card sections. */
import type { IntensityGauge } from '../engine/models';
import { formatSessionLoad } from '../sessions/loadDisplay';
import type { RangeOrNumber, SessionEffort, SessionEntryPayload } from '../sessions/models';
import type { StepComparison } from '../sessions/performedComparison';
import type { CompletedWorkoutView } from '../training-occurrence/completedWorkoutView';
import type { PerformedRestDetail, PrescribedStepTarget } from '../training-occurrence/structuredSetDetail';

export function sourceBadgeLabel(workout: CompletedWorkoutView): string {
  if (workout.sourceBadge.hasStructured && workout.sourceBadge.hasProvider) {
    return `Adaptive Coach + ${workout.sourceBadge.providers.map(p => p[0]!.toUpperCase() + p.slice(1)).join(', ')}`;
  }
  if (workout.sourceBadge.hasStructured) return 'Adaptive Coach';
  if (workout.sourceBadge.hasProvider) return workout.sourceBadge.providers.map(p => p[0]!.toUpperCase() + p.slice(1)).join(', ');
  return 'Unknown source';
}

export function workoutTitle(workout: CompletedWorkoutView): string {
  return workout.structured?.title ?? workout.garmin?.type.replaceAll('_', ' ') ?? 'Workout';
}

export function formatLocalTime(iso: string | undefined): string | null {
  if (!iso) return null;
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Warsaw',
  });
}

export function formatRange(value: RangeOrNumber, format: (n: number) => string = String): string {
  return typeof value === 'number' ? format(value) : `${format(value.min)}–${format(value.max)}`;
}

export function formatClock(totalSeconds: number): string {
  const rounded = Math.round(totalSeconds);
  const minutes = Math.floor(rounded / 60);
  const seconds = rounded % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export function formatEffort(effort: SessionEffort): string | null {
  if (effort.rir !== undefined) return `RIR ${formatRange(effort.rir)}`;
  if (effort.rpe !== undefined) return `RPE ${formatRange(effort.rpe)}`;
  return null;
}

export function formatGauge(gauge: IntensityGauge): string {
  switch (gauge.scale) {
    case 'rir': return `RIR ${gauge.value}`;
    case 'rpe_rts': return `RPE ${gauge.value}`;
    case 'velocity_loss': return `VL ${gauge.percent}%`;
    case 'technical': return gauge.met ? 'technique held' : 'technique broke down';
  }
}

export function formatTarget(target: PrescribedStepTarget): string {
  const parts: string[] = [];
  if (target.reps !== undefined) parts.push(`${target.sets} × ${formatRange(target.reps)}`);
  else if (target.seconds !== undefined) parts.push(`${target.sets} × ${formatRange(target.seconds, formatClock)}`);
  else if (target.meters !== undefined) parts.push(`${target.sets} × ${formatRange(target.meters)} m`);
  else parts.push(`${target.sets} ${target.sets === 1 ? 'set' : 'sets'}`);
  if (target.load) parts[0] += ` @ ${formatSessionLoad(target.load)}`;
  const effort = target.effort ? formatEffort(target.effort) : null;
  if (effort) parts.push(effort);
  if (target.restSeconds !== undefined) parts.push(`rest ${formatRange(target.restSeconds, formatClock)}`);
  return parts.join(' · ');
}

export function formatPerformed(payload: SessionEntryPayload): string {
  switch (payload.kind) {
    case 'repetition': {
      const work = payload.weightKg !== undefined && payload.weightKg > 0
        ? `${payload.reps} × ${payload.weightKg} kg`
        : `${payload.reps} reps`;
      const jump = [
        payload.jumpHeightCm !== undefined ? ` · best ${payload.jumpHeightCm} cm` : '',
        payload.jumpDistanceMeters !== undefined ? ` · best ${payload.jumpDistanceMeters} m` : '',
      ].join('');
      return payload.gauge ? `${work}${jump} · ${formatGauge(payload.gauge)}` : `${work}${jump}`;
    }
    case 'duration': {
      const hold = `${formatClock(payload.seconds)}${payload.loadKg ? ` @ ${payload.loadKg} kg` : ''}`;
      return payload.gauge ? `${hold} · ${formatGauge(payload.gauge)}` : hold;
    }
    case 'distance': {
      const carry = `${payload.meters} m${payload.durationSeconds !== undefined ? ` in ${formatClock(payload.durationSeconds)}` : ''}${payload.loadKg ? ` @ ${payload.loadKg} kg` : ''}`;
      return payload.gauge ? `${carry} · ${formatGauge(payload.gauge)}` : carry;
    }
    case 'sprint':
      return `${payload.meters} m in ${payload.splitSeconds.toFixed(2)} s`;
    case 'jump_attempt':
      if (payload.heightInches !== undefined) return `${payload.heightInches} in`;
      return payload.distanceMeters !== undefined ? `${payload.distanceMeters} m` : 'Attempt';
    case 'checkoff':
      return payload.completed ? 'Done' : 'Not done';
    case 'choice':
      return 'Choice';
  }
}

/** Rest that ran until the session ended is not rest between sets -- omitted rather
 * than shown as a misleadingly long interval. */
export function formatRest(rest: PerformedRestDetail): string | null {
  if (rest.endReason === 'session_ended') return null;
  const actual = rest.endReason === 'skipped' ? `Rest skipped at ${formatClock(rest.actualSeconds)}` : `Rest ${formatClock(rest.actualSeconds)}`;
  return rest.prescribedSeconds !== undefined ? `${actual} (target ${formatClock(rest.prescribedSeconds)})` : actual;
}

/** Completion is the shared planned-vs-performed comparison's call (work sets only --
 * warm-ups never complete a prescription, ADR-0021 D-SETLOG); the card does not recount. */
export function stepStatus(comparison: StepComparison | undefined): string | null {
  if (!comparison) return null;
  if (comparison.isComplete) return '✓ complete';
  const logged = comparison.entries.length > 0;
  if (comparison.isOptional) return logged ? 'optional, partial' : 'optional, skipped';
  return logged ? `✗ ${comparison.completedSets}/${comparison.targetSets} sets` : '✗ missed';
}
