import {
    evaluatePhysiologicalAnomaly,
    isAdverseCoreSignalEvidence,
    SHADOW_V1_HEALTH_ANOMALY_THRESHOLDS,
} from './healthAnomaly';
import { HEALTH_ANOMALY_BASELINE_WINDOW_DAYS, mapRecoverySnapshotToHealthAnomalyFeatures } from './healthAnomalyFeatures';
import type {
    CoreSignalEvidence,
    HealthAnomalyFeatureSet,
    HealthAnomalyThresholdPolicy,
    PhysiologicalAnomalyAssessment,
    RespirationElevationEvidence,
} from './healthAnomalyModels';
import type { DailyRecoverySnapshot, DailySubjectiveCheckin } from './models';
import { addDaysToLocalDateString } from '../utils/localDate';

export interface HealthAnomalyReplayDay {
    date: string;
    recoverySnapshot: DailyRecoverySnapshot | null;
    subjectiveCheckin?: DailySubjectiveCheckin | null;
    authoredTravelActive?: boolean | null;
}

export interface HealthAnomalyReplayInput {
    userId?: string;
    days: HealthAnomalyReplayDay[];
}

export interface HealthAnomalyReplayPolicyResult {
    thresholdPolicyVersion: string;
    state: PhysiologicalAnomalyAssessment['state'];
    evidenceLevel: PhysiologicalAnomalyAssessment['evidenceLevel'];
    unexplainedEvidence: string[];
    persistenceDays: number;
    episodeId: string | null;
    episodeDay: number | null;
}

export interface HealthAnomalyReplayRow {
    date: string;
    respirationElevation: RespirationElevationEvidence | null;
    coreEvidence: CoreSignalEvidence[];
    candidateEstimators: HealthAnomalyFeatureSet['coreSignals'];
    hardSessionContext: {
        last3DaysHardSessionsCount: number;
        yesterdayHardActivityCount: number | null;
        todayHardActivityCount: number | null;
    };
    sleepStressContext: {
        sleepScore: number | null;
        sleepDurationMin: number | null;
        subjectiveSleepQuality: number | null;
        garminStressAvg: number | null;
        subjectiveMentalStress: number | null;
    };
    healthContext: {
        alcoholDrinksLast24h: number | null;
        travelDisruption: string | null;
        authoredTravelActive: boolean | null;
        unusualHeatOrSauna: boolean | null;
        dehydrationOrFluidLoss: boolean | null;
        recentVaccination: boolean | null;
        medicationChange: boolean | null;
        closeSickContact: boolean | null;
    };
    assessmentStates: Record<string, HealthAnomalyReplayPolicyResult>;
    symptomsReported: boolean;
    futureSymptoms24h: boolean;
    futureSymptoms48h: boolean;
    futureSymptoms72h: boolean;
}

export interface HealthAnomalyReplayReport {
    generatedFrom: 'historical-replay';
    evaluatorMode: 'shadow-v1';
    candidatePolicyVersions: string[];
    observedDays: number;
    respirationElevationSummary: {
        statusCounts: Record<string, number>;
        elevatedOrStrongDays: number;
        persistentTwoNightDays: number;
        corroboratedDays: number;
        isolatedDays: number;
        resolvingDays: number;
        unavailableDays: number;
        unavailableRate: number;
        unavailableReasonCounts: Record<string, number>;
        robustDeviation: {
            /** 28-day median/MAD standardized respiration evidence available for replay calibration. */
            availableDays: number;
            elevatedAvailableDays: number;
            elevatedMedian: number | null;
            elevatedMin: number | null;
            elevatedMax: number | null;
        };
    };
    limitations: string[];
    rows: HealthAnomalyReplayRow[];
}

export const HEALTH_ANOMALY_REPLAY_POLICIES: readonly HealthAnomalyThresholdPolicy[] = [
    SHADOW_V1_HEALTH_ANOMALY_THRESHOLDS,
];

function symptomsReported(checkin: DailySubjectiveCheckin | null | undefined): boolean {
    return checkin?.healthContext?.symptoms?.present === true || checkin?.illnessSymptoms === true;
}

function withinHistoryWindow(date: string, candidateDate: string): boolean {
    const start = addDaysToLocalDateString(date, -HEALTH_ANOMALY_BASELINE_WINDOW_DAYS);
    return candidateDate >= start && candidateDate < date;
}

function policyResult(assessment: PhysiologicalAnomalyAssessment): HealthAnomalyReplayPolicyResult {
    return {
        thresholdPolicyVersion: assessment.thresholdPolicyVersion,
        state: assessment.state,
        evidenceLevel: assessment.evidenceLevel,
        unexplainedEvidence: [...assessment.unexplainedEvidence],
        persistenceDays: assessment.persistenceDays,
        episodeId: assessment.episodeId,
        episodeDay: assessment.episodeDay,
    };
}

function futureSymptoms(
    symptomDates: ReadonlySet<string>,
    date: string,
    horizonDays: 1 | 2 | 3,
): boolean {
    for (let offset = 1; offset <= horizonDays; offset += 1) {
        if (symptomDates.has(addDaysToLocalDateString(date, offset))) return true;
    }
    return false;
}

function isElevatedRespiration(row: HealthAnomalyReplayRow): boolean {
    return row.respirationElevation?.status === 'elevated'
        || row.respirationElevation?.status === 'strongly_elevated';
}

function respirationStandardizedDeviation(row: HealthAnomalyReplayRow): number | null {
    const deviation = row.coreEvidence.find(evidence => evidence.signal === 'respiration')?.standardizedDeviation ?? null;
    return deviation !== null && Number.isFinite(deviation) ? deviation : null;
}

function median(values: readonly number[]): number | null {
    if (values.length === 0) return null;
    const sorted = [...values].sort((left, right) => left - right);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0
        ? (sorted[middle - 1] + sorted[middle]) / 2
        : sorted[middle];
}

function summarizeRespirationElevation(rows: HealthAnomalyReplayRow[]): HealthAnomalyReplayReport['respirationElevationSummary'] {
    const statusCounts = rows.reduce<Record<string, number>>((counts, row) => {
        const status = row.respirationElevation?.status ?? 'unavailable';
        counts[status] = (counts[status] ?? 0) + 1;
        return counts;
    }, {});
    const unavailableReasonCounts = rows.reduce<Record<string, number>>((counts, row) => {
        if (row.respirationElevation?.status !== 'unavailable') return counts;
        for (const reason of row.respirationElevation.reasonCodes) {
            counts[reason] = (counts[reason] ?? 0) + 1;
        }
        return counts;
    }, {});
    const byDate = new Map(rows.map(row => [row.date, row]));
    const elevated = rows.filter(isElevatedRespiration);
    const corroborated = elevated.filter(row => row.coreEvidence.some(
        evidence => evidence.signal !== 'respiration' && isAdverseCoreSignalEvidence(evidence),
    ));
    const robustAvailable = rows
        .map(respirationStandardizedDeviation)
        .filter((value): value is number => value !== null);
    const robustElevated = elevated
        .map(respirationStandardizedDeviation)
        .filter((value): value is number => value !== null);
    const unavailableDays = statusCounts.unavailable ?? 0;
    return {
        statusCounts,
        elevatedOrStrongDays: elevated.length,
        persistentTwoNightDays: elevated.filter(row => {
            const previous = byDate.get(addDaysToLocalDateString(row.date, -1));
            return previous ? isElevatedRespiration(previous) : false;
        }).length,
        corroboratedDays: corroborated.length,
        isolatedDays: elevated.length - corroborated.length,
        resolvingDays: statusCounts.resolving ?? 0,
        unavailableDays,
        unavailableRate: rows.length > 0 ? unavailableDays / rows.length : 0,
        unavailableReasonCounts,
        robustDeviation: {
            availableDays: robustAvailable.length,
            elevatedAvailableDays: robustElevated.length,
            elevatedMedian: median(robustElevated),
            elevatedMin: robustElevated.length > 0 ? Math.min(...robustElevated) : null,
            elevatedMax: robustElevated.length > 0 ? Math.max(...robustElevated) : null,
        },
    };
}

/**
 * Historical HA5 replay. Evaluation for each row receives only current-day inputs and prior
 * recovery history. Future symptom observations are joined after all assessments have already
 * been computed, making them labels only and preventing retrospective leakage into the live
 * state machine.
 */
export function runHealthAnomalyReplay(
    input: HealthAnomalyReplayInput,
    policies: readonly HealthAnomalyThresholdPolicy[] = HEALTH_ANOMALY_REPLAY_POLICIES,
): HealthAnomalyReplayReport {
    const days = [...input.days].sort((left, right) => left.date.localeCompare(right.date));
    const priorAssessments = new Map<string, { date: string; assessment: PhysiologicalAnomalyAssessment }>();
    const rowsWithoutLabels: Omit<HealthAnomalyReplayRow, 'futureSymptoms24h' | 'futureSymptoms48h' | 'futureSymptoms72h'>[] = [];

    for (const day of days) {
        const history = days
            .filter(candidate => candidate.recoverySnapshot && withinHistoryWindow(day.date, candidate.date))
            .map(candidate => candidate.recoverySnapshot as DailyRecoverySnapshot);
        const features = day.recoverySnapshot
            ? mapRecoverySnapshotToHealthAnomalyFeatures(day.recoverySnapshot, history)
            : null;
        const assessmentStates: Record<string, HealthAnomalyReplayPolicyResult> = {};
        let representativeAssessment: PhysiologicalAnomalyAssessment | null = null;

        for (const thresholds of policies) {
            const previous = priorAssessments.get(thresholds.policyVersion) ?? null;
            const assessment = evaluatePhysiologicalAnomaly({
                date: day.date,
                timezone: 'Europe/Warsaw',
                recoverySnapshot: day.recoverySnapshot,
                subjectiveCheckin: day.subjectiveCheckin ?? null,
                features,
                coreSignals: [],
                supportingSignals: [],
                dataQuality: features?.coreSignals.map(signal => signal.dataQuality) ?? [],
                last3DaysHardSessionsCount: day.recoverySnapshot?.raw.last3DaysHardSessionsCount ?? 0,
                structuredContext: {
                    authoredTravelActive: day.authoredTravelActive ?? null,
                    authoredTravelRevision: null,
                },
                persistence: {
                    previousState: previous?.assessment.state ?? null,
                    previousEpisodeId: previous?.assessment.episodeId ?? null,
                    previousEpisodeDay: previous?.assessment.episodeDay ?? null,
                    previousAssessmentDate: previous?.date ?? null,
                    unexplainedPersistenceDays: previous && previous.assessment.unexplainedEvidence.length > 0
                        ? previous.assessment.persistenceDays
                        : 0,
                },
            }, 'shadow-v1', thresholds);
            if (!assessment) continue;
            assessmentStates[thresholds.policyVersion] = policyResult(assessment);
            priorAssessments.set(thresholds.policyVersion, { date: day.date, assessment });
            representativeAssessment ??= assessment;
        }

        const checkin = day.subjectiveCheckin ?? null;
        const health = checkin?.healthContext;
        rowsWithoutLabels.push({
            date: day.date,
            respirationElevation: representativeAssessment?.respirationElevation ?? null,
            coreEvidence: representativeAssessment?.coreSignals ?? [],
            candidateEstimators: features?.coreSignals ?? [],
            hardSessionContext: {
                last3DaysHardSessionsCount: day.recoverySnapshot?.raw.last3DaysHardSessionsCount ?? 0,
                yesterdayHardActivityCount: day.recoverySnapshot?.raw.yesterdayTraining?.hardActivityCount ?? null,
                todayHardActivityCount: day.recoverySnapshot?.raw.todayTraining?.hardActivityCount ?? null,
            },
            sleepStressContext: {
                sleepScore: day.recoverySnapshot?.raw.sleepScore ?? null,
                sleepDurationMin: day.recoverySnapshot?.raw.sleepDurationSec != null
                    ? day.recoverySnapshot.raw.sleepDurationSec / 60
                    : null,
                subjectiveSleepQuality: checkin?.sleepQuality ?? null,
                garminStressAvg: day.recoverySnapshot?.raw.stress?.avg ?? null,
                subjectiveMentalStress: checkin?.mentalStress ?? null,
            },
            healthContext: {
                alcoholDrinksLast24h: health?.alcoholDrinksLast24h ?? null,
                travelDisruption: health?.travelDisruption ?? null,
                authoredTravelActive: day.authoredTravelActive ?? null,
                unusualHeatOrSauna: health?.unusualHeatOrSauna ?? null,
                dehydrationOrFluidLoss: health?.dehydrationOrFluidLoss ?? null,
                recentVaccination: health?.recentVaccination ?? null,
                medicationChange: health?.medicationChange ?? null,
                closeSickContact: health?.closeSickContact ?? null,
            },
            assessmentStates,
            symptomsReported: symptomsReported(checkin),
        });
    }

    const symptomDates = new Set(days.filter(day => symptomsReported(day.subjectiveCheckin)).map(day => day.date));
    const rows: HealthAnomalyReplayRow[] = rowsWithoutLabels.map(row => ({
        ...row,
        futureSymptoms24h: futureSymptoms(symptomDates, row.date, 1),
        futureSymptoms48h: futureSymptoms(symptomDates, row.date, 2),
        futureSymptoms72h: futureSymptoms(symptomDates, row.date, 3),
    }));

    return {
        generatedFrom: 'historical-replay',
        evaluatorMode: 'shadow-v1',
        candidatePolicyVersions: policies.map(policy => policy.policyVersion),
        observedDays: rows.length,
        respirationElevationSummary: summarizeRespirationElevation(rows),
        limitations: [
            'Future 24/48/72h symptom flags are retrospective labels joined after evaluation and are never live evaluator input.',
            'Candidate thresholds are shadow calibration parameters, not validated diagnostic cutoffs.',
            'Respiration corroboration counts only adverse non-respiratory core evidence; unusually high HRV is retained as telemetry but is not an adverse illness vote.',
            'MAD-normalized respiration deviation is descriptive calibration telemetry only; it is not an additional decision threshold or permission to tighten training.',
            'Replay quality is limited by the completeness and correctness of supplied canonical recovery/check-in history.',
        ],
        rows,
    };
}

function evidenceCell(evidence: CoreSignalEvidence | undefined): string {
    if (!evidence) return 'unavailable';
    const deviation = evidence.standardizedDeviation == null
        ? ''
        : ` ${(evidence.standardizedDeviation >= 0 ? '+' : '')}${evidence.standardizedDeviation.toFixed(2)}z`;
    return `${evidence.status}${evidence.direction ? `/${evidence.direction}` : ''}${deviation}`;
}

function numberOrNa(value: number | null, digits = 2): string {
    return value === null ? 'N/A' : value.toFixed(digits);
}

export function renderHealthAnomalyReplayMarkdown(report: HealthAnomalyReplayReport): string {
    const primaryPolicy = report.candidatePolicyVersions[0];
    const summary = report.respirationElevationSummary;
    const robust = summary.robustDeviation;
    const lines = [
        '# Health anomaly shadow replay',
        '',
        `- Observed days: ${report.observedDays}`,
        `- Evaluator mode: ${report.evaluatorMode}`,
        `- Candidate policies: ${report.candidatePolicyVersions.join(', ') || 'none'}`,
        `- Respiration elevation statuses: ${JSON.stringify(summary.statusCounts)}`,
        `- Respiration unavailable: ${summary.unavailableDays}/${report.observedDays} (${(summary.unavailableRate * 100).toFixed(1)}%); reasons: ${JSON.stringify(summary.unavailableReasonCounts)}`,
        `- Elevated/strong days: ${summary.elevatedOrStrongDays}; two-night persistent: ${summary.persistentTwoNightDays}; corroborated: ${summary.corroboratedDays}; isolated: ${summary.isolatedDays}; resolving: ${summary.resolvingDays}`,
        `- Robust 28d MAD-normalized respiration deviation: available ${robust.availableDays}/${report.observedDays}; elevated-with-scale ${robust.elevatedAvailableDays}/${summary.elevatedOrStrongDays}; elevated median ${numberOrNa(robust.elevatedMedian)}z (range ${numberOrNa(robust.elevatedMin)} to ${numberOrNa(robust.elevatedMax)}z)`,
        '',
        '## Evidence framing',
        '',
        ...report.limitations.map(item => `- ${item}`),
        '',
        '| Date | RHR | Respiration | Resp. delta status | HRV | Hard 3d | Sleep | Stress | State | Symptoms | +24h | +48h | +72h |',
        '| --- | --- | --- | --- | --- | ---: | ---: | ---: | --- | --- | --- | --- | --- |',
        ...report.rows.map(row => {
            const state = primaryPolicy ? row.assessmentStates[primaryPolicy]?.state ?? 'N/A' : 'N/A';
            return `| ${row.date} | ${evidenceCell(row.coreEvidence.find(item => item.signal === 'rhr'))} | ${evidenceCell(row.coreEvidence.find(item => item.signal === 'respiration'))} | ${row.respirationElevation?.status ?? 'unavailable'} | ${evidenceCell(row.coreEvidence.find(item => item.signal === 'hrv'))} | ${row.hardSessionContext.last3DaysHardSessionsCount} | ${row.sleepStressContext.sleepScore ?? 'N/A'} | ${row.sleepStressContext.garminStressAvg ?? 'N/A'} | ${state} | ${row.symptomsReported ? 'yes' : 'no'} | ${row.futureSymptoms24h ? 'yes' : 'no'} | ${row.futureSymptoms48h ? 'yes' : 'no'} | ${row.futureSymptoms72h ? 'yes' : 'no'} |`;
        }),
        '',
    ];
    return lines.join('\n');
}
