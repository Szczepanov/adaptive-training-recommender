import type { DailyRecoverySnapshot } from './models';
import type { BodyCompositionBriefInput } from './contextBrief';

/* Recovery-evidence renderers for the context brief (objective wearable section and body
 * composition), split out of `contextBrief.ts` for size. Pure: no I/O. */

export function mean(values: readonly (number | null | undefined)[]): number | null {
    const present = values.filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
    if (present.length === 0) return null;
    return present.reduce((sum, value) => sum + value, 0) / present.length;
}

export function round(value: number | null | undefined, places = 1): string {
    if (value === null || value === undefined || !Number.isFinite(value)) return '—';
    const factor = 10 ** places;
    return String(Math.round(value * factor) / factor);
}

export function signed(value: number | null | undefined, places = 1): string {
    if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
    const rounded = Math.round(value * 10 ** places) / 10 ** places;
    return rounded > 0 ? `+${rounded}` : String(rounded);
}

/** Renders a metric as "current (7d avg, 28d avg) — Δ vs 7d, Δ vs 28d", collapsing to a
 * dash per component so a partially-synced day still produces a readable line. */
function metricLine(
    label: string,
    unit: string,
    current: number | null,
    avg7d: number | null,
    avg28d: number | null,
    deltaVs7d: number | null,
    deltaVs28d: number | null,
): string {
    const baselines = `7d ${round(avg7d)}, 28d ${round(avg28d)}`;
    const deltas = `${signed(deltaVs7d)} vs 7d, ${signed(deltaVs28d)} vs 28d`;
    return `- ${label}: ${round(current)} ${unit} (${baselines}) — ${deltas}`;
}

/** Observation-only robust baseline renderer. Keeping this separate from metricLine makes
 * the estimator semantics explicit in the exported text instead of letting an external AI
 * mistake median/MAD candidate statistics for the live mean/stdev engine inputs. */
function candidateBaselineLine(
    label: string,
    unit: string,
    current: number | null | undefined,
    median7d: number | null | undefined,
    median28d: number | null | undefined,
    mad28d: number | null | undefined,
    deltaVs7dMedian: number | null | undefined,
    deltaVs28dMedian: number | null | undefined,
): string {
    const currentValue = typeof current === 'number' && Number.isFinite(current) ? current : null;
    const median7 = typeof median7d === 'number' && Number.isFinite(median7d) ? median7d : null;
    const median28 = typeof median28d === 'number' && Number.isFinite(median28d) ? median28d : null;
    const mad28 = typeof mad28d === 'number' && Number.isFinite(mad28d) ? mad28d : null;
    const baselines = `7d median ${round(median7)}, 28d median ${round(median28)}, 28d MAD ${round(mad28)}`;
    const deltas = `${signed(deltaVs7dMedian)} vs 7d median, ${signed(deltaVs28dMedian)} vs 28d median`;
    return `- ${label}: ${round(currentValue)} ${unit} (${baselines}) — ${deltas}`;
}

export function renderObjective(snapshots: readonly DailyRecoverySnapshot[], windowDays: number, heading: string, compact: boolean): string[] {
    const lines: string[] = [heading, ''];
    if (snapshots.length === 0) {
        lines.push('No wearable data in this window.');
        return lines;
    }
    const latest = snapshots[snapshots.length - 1];
    const { raw, derived, dataQuality } = latest;
    const baselineVersion = derived.baselineComputationVersion ?? 0;

    lines.push(`Most recent reading — ${latest.date}:`);
    lines.push(metricLine('HRV (overnight avg)', 'ms', raw.hrvOvernightAvg, derived.hrv7dAvg, derived.hrv28dAvg, derived.deltas.hrvVs7d, derived.deltas.hrvVs28d));
    lines.push(metricLine('Resting HR', 'bpm', raw.restingHr, derived.restingHr7dAvg, derived.restingHr28dAvg, derived.deltas.restingHrVs7d, derived.deltas.restingHrVs28d));
    lines.push(metricLine('Sleep score', 'pts', raw.sleepScore, derived.sleepScore7dAvg, derived.sleepScore28dAvg, derived.deltas.sleepScoreVs7d, derived.deltas.sleepScoreVs28d));
    if (raw.totalSteps !== null) {
        lines.push(metricLine('Steps (yesterday D-1)', 'steps', raw.totalSteps, derived.steps7dAvg ?? null, derived.steps28dAvg ?? null, derived.deltas.stepsVs7d ?? null, derived.deltas.stepsVs28d ?? null));
    }
    if (baselineVersion >= 3 && !compact) {
        lines.push(candidateBaselineLine(
            'Respiration robust baseline', 'br/min', raw.respirationAvg,
            derived.respiration7dAvg, derived.respiration28dAvg, derived.respiration28dMad,
            derived.deltas.respirationVs7d, derived.deltas.respirationVs28d,
        ));
    } else if (raw.respirationAvg !== null && !compact) {
        lines.push(`- Respiration: ${round(raw.respirationAvg)} br/min (legacy pre-v3 baseline fields use mean; robust median/MAD unavailable)`);
    }
    // Vendor composites overlap upstream with HRV/sleep/stress/load. In planning mode they
    // sit under one explicitly secondary label instead of reading as independent baseline
    // families; their candidate median/MAD variants are diagnostic-only.
    const composites: string[] = [];
    if (raw.bodyBatteryWake !== null) composites.push(`- Body battery on waking: ${raw.bodyBatteryWake}`);
    if (raw.stress?.avg != null || raw.stress?.max != null) {
        composites.push(`- Device stress: avg ${raw.stress?.avg ?? '—'} · max ${raw.stress?.max ?? '—'}`);
    }
    if (raw.hrvStatus) composites.push(`- HRV status (device): ${raw.hrvStatus}`);
    if (raw.trainingReadiness?.score != null) {
        composites.push(`- Device training readiness: ${raw.trainingReadiness.score}${raw.trainingReadiness.level ? ` (${raw.trainingReadiness.level})` : ''}`);
    }

    const status = raw.trainingStatus;
    if (status) {
        const statusParts: string[] = [];
        if (status.statusPhrase) statusParts.push(status.statusPhrase);
        if (status.acuteTrainingLoad != null) statusParts.push(`acute load ${status.acuteTrainingLoad}`);
        if (status.acwrStatus) statusParts.push(`acute:chronic ${status.acwrStatus}`);
        if (status.vo2MaxCycling != null) statusParts.push(`VO2max cycling ${status.vo2MaxCycling}`);
        if (status.vo2MaxRunning != null) statusParts.push(`VO2max running ${status.vo2MaxRunning}`);
        if (statusParts.length > 0) composites.push(`- Device training status: ${statusParts.join(' · ')}`);
    }
    if (compact && composites.length > 0) {
        lines.push('', 'Secondary device composites (context only; correlated with the metrics above, not independent evidence):');
    }
    lines.push(...composites);

    if (baselineVersion >= 3 && !compact) {
        lines.push('');
        lines.push('> Respiration robust baseline is exported for context, but production respiration strain scoring is currently OFF by default. Do not treat it as an additional live readiness penalty.');
    }

    if (baselineVersion >= 3 && compact) {
        lines.push('');
        lines.push('> Planning export: observation-only candidate baselines (median/MAD) and the respiration candidate '
            + '(production respiration scoring is off) are omitted. They carry no recommendation authority; '
            + 'use the diagnostic export to inspect them.');
    }

    if (baselineVersion >= 4 && !compact) {
        lines.push('');
        lines.push('Observation-only candidate baselines (not independent engine inputs):');
        lines.push('These median/MAD summaries are exported for inspection and future calibration. They do not replace the live mean/stdev paths and must not be stacked as extra strain votes.');
        lines.push(candidateBaselineLine(
            'Sleep score candidate', 'pts', raw.sleepScore,
            derived.sleepScore7dMedian, derived.sleepScore28dMedian, derived.sleepScore28dMad,
            derived.deltas.sleepScoreVs7dMedian, derived.deltas.sleepScoreVs28dMedian,
        ));
        lines.push(candidateBaselineLine(
            'Resting HR candidate', 'bpm', raw.restingHr,
            derived.restingHr7dMedian, derived.restingHr28dMedian, derived.restingHr28dMad,
            derived.deltas.restingHrVs7dMedian, derived.deltas.restingHrVs28dMedian,
        ));
        lines.push(candidateBaselineLine(
            'HRV candidate', 'ms', raw.hrvOvernightAvg,
            derived.hrv7dMedian, derived.hrv28dMedian, derived.hrv28dMad,
            derived.deltas.hrvVs7dMedian, derived.deltas.hrvVs28dMedian,
        ));
        lines.push(candidateBaselineLine(
            'Steps candidate (yesterday D-1)', 'steps', raw.totalSteps,
            derived.steps7dMedian, derived.steps28dMedian, derived.steps28dMad,
            derived.deltas.stepsVs7dMedian, derived.deltas.stepsVs28dMedian,
        ));
    }

    if (baselineVersion >= 5 && !compact) {
        lines.push(candidateBaselineLine(
            'Body Battery wake candidate', 'pts', raw.bodyBatteryWake,
            derived.bodyBatteryWake7dMedian, derived.bodyBatteryWake28dMedian, derived.bodyBatteryWake28dMad,
            derived.deltas.bodyBatteryWakeVs7dMedian, derived.deltas.bodyBatteryWakeVs28dMedian,
        ));
        lines.push(candidateBaselineLine(
            'Stress avg candidate', 'pts', raw.stress?.avg,
            derived.stressAvg7dMedian, derived.stressAvg28dMedian, derived.stressAvg28dMad,
            derived.deltas.stressAvgVs7dMedian, derived.deltas.stressAvgVs28dMedian,
        ));
        lines.push(candidateBaselineLine(
            'Stress max candidate', 'pts', raw.stress?.max,
            derived.stressMax7dMedian, derived.stressMax28dMedian, derived.stressMax28dMad,
            derived.deltas.stressMaxVs7dMedian, derived.deltas.stressMaxVs28dMedian,
        ));
        lines.push(candidateBaselineLine(
            'Training Readiness score candidate', 'pts', raw.trainingReadiness?.score,
            derived.trainingReadinessScore7dMedian, derived.trainingReadinessScore28dMedian, derived.trainingReadinessScore28dMad,
            derived.deltas.trainingReadinessScoreVs7dMedian, derived.deltas.trainingReadinessScoreVs28dMedian,
        ));
        lines.push('');
        lines.push('> Correlation caution: Body Battery, stress and Training Readiness overlap upstream with HRV, sleep, stress and load physiology. Treat them as correlated observations, not independent additive evidence.');
    }

    lines.push('');
    lines.push(`Window averages (${snapshots.length} of ${windowDays} days have data):`);
    lines.push(`- HRV ${round(mean(snapshots.map(s => s.raw.hrvOvernightAvg)))} ms · resting HR ${round(mean(snapshots.map(s => s.raw.restingHr)))} bpm · sleep score ${round(mean(snapshots.map(s => s.raw.sleepScore)))}`);

    if (!dataQuality.baseline28dReady) {
        lines.push('');
        lines.push('> Caution: the 28-day baseline is not yet mature, so the "vs 28d" deltas above are computed from partial history and should be weighted lightly.');
    }
    return lines;
}

export /** Ownership: ADR-0039 (body-composition and fueling observations). Zero recommendation
 * authority in the engine — see the isolation note on `ContextBriefInput.bodyComposition`.
 * Placed alongside wearable recovery rather than as its own numbered section so it does
 * not collide with the "## 7"/"## 8" handoff sections `contextBriefPlanningHandoff.ts`
 * appends for the full-preset pipeline. */
function renderBodyComposition(input: BodyCompositionBriefInput | undefined, compact: boolean): string[] {
    if (!input) return [];
    const { bodyMass, circumferences, bodyFatPct } = input;
    if (!bodyMass && circumferences.length === 0 && !bodyFatPct) return [];

    const lines: string[] = [
        '### Body composition & fueling (observation only)',
        '',
        'Athlete-authored home anthropometry and device body-composition estimates. Zero '
        + 'recommendation authority in this app\'s engine — exported for context only, not '
        + 'an independent readiness or training-load input.',
        '',
    ];

    if (bodyMass) {
        const sourceLabel = bodyMass.source === 'provider' ? 'device-estimated' : 'manually logged';
        lines.push(`- Body mass (${sourceLabel}): latest ${round(bodyMass.latestKg, 2)} kg${bodyMass.latestDate ? ` (${bodyMass.latestDate})` : ''}`);
        if (bodyMass.current7dMeanKg !== null && bodyMass.prior7dMeanKg !== null) {
            lines.push(
                `  - 7d mean ${round(bodyMass.current7dMeanKg, 2)} kg vs prior 7d ${round(bodyMass.prior7dMeanKg, 2)} kg `
                + `— ${signed(bodyMass.weekOverWeekKg, 2)} kg (${signed(bodyMass.weekOverWeekPercent)}%)`,
            );
        } else {
            lines.push('  - Not enough recorded days yet for a week-over-week trend (needs 4+ of 7 days on both sides).');
        }
    }

    if (bodyFatPct) {
        const trend = bodyFatPct.mean7dPct !== null
            ? `7d mean ${round(bodyFatPct.mean7dPct)}%`
            : `7d mean insufficient data (${bodyFatPct.recordedDays7d}/7 days recorded, 4+ required)`;
        lines.push(
            `- Body fat % (${compact ? 'low-authority device estimate; read the trend, not the absolute value' : 'device estimate'}): latest ${round(bodyFatPct.latestPct)}%`
            + `${bodyFatPct.latestDate ? ` (${bodyFatPct.latestDate})` : ''} · ${trend}`,
        );
    }

    if (circumferences.length > 0) {
        lines.push('- Tape circumferences (protocol-aware, athlete-authored):');
        for (const c of circumferences) {
            const deltaStr = c.deltaCm === null ? 'no prior reading yet' : `${signed(c.deltaCm)} cm vs previous reading`;
            const warning = c.repeatabilityWarning ? ' — repeatability tolerance exceeded on the latest reading, treat with caution' : '';
            lines.push(`  - ${c.label}: ${round(c.latestCm, 1)} cm${c.latestDate ? ` (${c.latestDate})` : ''} — ${deltaStr}${warning}`);
        }
    }

    return lines;
}
