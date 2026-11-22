import type { recommendationService } from '../../services/recommendationService';

export type DataViewTab =
  | 'recovery'
  | 'activities'
  | 'strength'
  | 'nutrition'
  | 'body'
  | 'checkin'
  | 'goals'
  | 'constraints'
  | 'preferences'
  | 'adherence'
  | 'brief';

export type AdherenceStats = Awaited<ReturnType<typeof recommendationService.getAdherenceStats>>;

// A schema/algorithm rollout gate on the account, not a fact about the athlete's own data --
// naming the internal version number ("requires baseline v4") tells the reader nothing
// actionable, so every gated field uses this one neutral label instead.
export const VERSION_GATED_NOT_AVAILABLE = 'Not available yet';

export function describeSourceState(status: 'MISSING' | 'INVALID' | 'UNAVAILABLE'): string {
  if (status === 'MISSING') return 'No record exists for this date yet.';
  if (status === 'INVALID') return 'The stored record is malformed and needs repair.';
  return 'The data source is temporarily unavailable. Retry the dashboard refresh.';
}

export function formatCandidateNumber(value: number | null | undefined): string {
  return typeof value === 'number' && Number.isFinite(value) ? String(value) : 'N/A';
}

export function formatCandidateDelta(value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'N/A';
  return value > 0 ? `+${value}` : String(value);
}

export function formatSleepStageMinutes(seconds: number | null | undefined): string {
  return typeof seconds === 'number' && Number.isFinite(seconds)
    ? `${Math.round(seconds / 60)}m`
    : 'N/A';
}

export function formatCandidateBaseline(
  median7d: number | null | undefined,
  median28d: number | null | undefined,
  mad28d: number | null | undefined,
  delta7d: number | null | undefined,
  delta28d: number | null | undefined,
): string {
  return `7d med ${formatCandidateNumber(median7d)} · 28d med ${formatCandidateNumber(median28d)} · MAD ${formatCandidateNumber(mad28d)} · Δ7 ${formatCandidateDelta(delta7d)} · Δ28 ${formatCandidateDelta(delta28d)}`;
}
