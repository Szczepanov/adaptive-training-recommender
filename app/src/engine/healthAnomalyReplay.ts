import { evaluatePhysiologicalAnomaly, SHADOW_V1_HEALTH_ANOMALY_THRESHOLDS } from './healthAnomaly';
import { HEALTH_ANOMALY_BASELINE_WINDOW_DAYS, mapRecoverySnapshotToHealthAnomalyFeatures } from './healthAnomalyFeatures';
import type {
    CoreSignalEvidence,
    HealthAnomalyFeatureSet,
    HealthAnomalyThresholdPolicy,
    PhysiologicalAnomalyAssessment,
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
        limitations: [
            'Future 24/48/72h symptom flags are retrospective labels joined after evaluation and are never live evaluator input.',
            'Candidate thresholds are shadow calibration parameters, not validated diagnostic cutoffs.',
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

export function renderHealthAnomalyReplayMarkdown(report: HealthAnomalyReplayReport): string {
    const primaryPolicy = report.candidatePolicyVersions[0];
    const lines = [
        '# Health anomaly shadow replay',
        '',
        `- Observed days: ${report.observedDays}`,
        `- Evaluator mode: ${report.evaluatorMode}`,
        `- Candidate policies: ${report.candidatePolicyVersions.join(', ') || 'none'}`,
        '',
        '## Evidence framing',
        '',
        ...report.limitations.map(item => `- ${item}`),
        '',
        '| Date | RHR | Respiration | HRV | Hard 3d | Sleep | Stress | State | Symptoms | +24h | +48h | +72h |',
        '| --- | --- | --- | --- | ---: | ---: | ---: | --- | --- | --- | --- | --- |',
        ...report.rows.map(row => {
            const state = primaryPolicy ? row.assessmentStates[primaryPolicy]?.state ?? 'N/A' : 'N/A';
            return `| ${row.date} | ${evidenceCell(row.coreEvidence.find(item => item.signal === 'rhr'))} | ${evidenceCell(row.coreEvidence.find(item => item.signal === 'respiration'))} | ${evidenceCell(row.coreEvidence.find(item => item.signal === 'hrv'))} | ${row.hardSessionContext.last3DaysHardSessionsCount} | ${row.sleepStressContext.sleepScore ?? 'N/A'} | ${row.sleepStressContext.garminStressAvg ?? 'N/A'} | ${state} | ${row.symptomsReported ? 'yes' : 'no'} | ${row.futureSymptoms24h ? 'yes' : 'no'} | ${row.futureSymptoms48h ? 'yes' : 'no'} | ${row.futureSymptoms72h ? 'yes' : 'no'} |`;
        }),
        '',
    ];
    return lines.join('\n');
}
