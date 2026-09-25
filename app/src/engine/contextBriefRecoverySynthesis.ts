import type { DailyRecoverySnapshot, DailySubjectiveCheckin } from './models';
import { PHYSIOLOGICAL_BOUNDS } from './dataConfidence';
import { round, signed } from './contextBriefRecovery';

/*
 * Issue #812: a compact, deterministic recovery-evidence synthesis for the context brief.
 *
 * Explanatory / observability support ONLY. Nothing in the engine reads this module; it
 * produces no score, changes no mode, dose, eligibility or ranking, and the readiness/safety
 * evaluation in `rules.ts` `evaluateReadinessAndSafetyEnvelope` stays the sole decision
 * authority. Because it has no decision authority, its bands are display constants and do
 * not need a knowledge claim (ADR-0033); where it mirrors a live threshold, a parity test
 * (`contextBriefRecoverySynthesis.test.ts`) keeps the mirror honest.
 *
 * Structure, not prose, prevents double counting: evidence is grouped into four
 * independent families (athlete-reported state, HRV, resting HR, sleep). Each family casts
 * at most one vote. Vendor composites (Body Battery, device stress, Training Readiness,
 * HRV status) are derived upstream from the same physiology and are listed as context only
 * — they never vote, so adding or removing them cannot move the pattern.
 *
 * Pure: reads only the already-fetched latest snapshot and the as-of-date check-in.
 */

export type RecoveryPattern = 'CONVERGENT_ADVERSE' | 'CONVERGENT_REASSURING' | 'MIXED' | 'INSUFFICIENT';
export type FamilyState = 'adverse' | 'reassuring' | 'neutral' | 'unavailable';
export type EvidenceFamily = 'subjective' | 'hrv' | 'rhr' | 'sleep';

export interface FamilyEvidence {
    family: EvidenceFamily;
    label: string;
    kind: 'athlete_reported' | 'measured_core';
    state: FamilyState;
    /** Provenance: the evidence line(s) and source date that produced the state. */
    detail: string;
}

export interface RecoveryDataConfidence {
    wearable: 'current' | 'stale' | 'missing';
    wearableDate: string | null;
    baseline: 'mature_28d' | 'partial_7d' | 'immature' | 'unknown';
    subjective: 'present' | 'missing';
    implausible: string[];
}

export interface RecoveryEvidenceSynthesis {
    asOfDate: string;
    pattern: RecoveryPattern;
    families: FamilyEvidence[];
    safetyFacts: string[];
    vendorContext: string[];
    confidence: RecoveryDataConfidence;
    uncertainty: string[];
    implications: string[];
}

// Mirrors of the live engine's personal-variability floors (`rules.ts`, private there).
// Used here only to decide "outside usual night-to-night variation" for display.
const HRV_SD_FLOOR_MS = 3;
const RHR_SD_FLOOR_BPM = 1.5;
const SLEEP_SD_FLOOR_PTS = 4;
/** Mirrors `rules.ts` SLEEP_SCORE_ABSOLUTE_FLOOR. */
const SLEEP_SCORE_ABSOLUTE_FLOOR = 50;
/** Display band: an average physical subjective load (fatigue, soreness, inverted readiness,
 * inverted sleep quality) at or below this reads as "low" — the engine's modify line is >5. */
const SUBJECTIVE_REASSURING_MAX_LOAD = 4;

const isNum = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

function plausible(value: number, bounds: { min: number; max: number }): boolean {
    return value >= bounds.min && value <= bounds.max;
}

interface ObjectiveSpec {
    family: Exclude<EvidenceFamily, 'subjective'>;
    label: string;
    unit: string;
    current: number | null;
    delta7d: number | null | undefined;
    sd28d: number | null | undefined;
    sdFloor: number;
    /** +1 when a higher value is adverse (RHR), -1 when a lower value is adverse. */
    adverseSign: 1 | -1;
    bounds: { min: number; max: number };
}

function classifyObjective(spec: ObjectiveSpec, snapshotDate: string, implausible: string[]): FamilyEvidence {
    const base = { family: spec.family, label: spec.label, kind: 'measured_core' as const };
    if (!isNum(spec.current)) return { ...base, state: 'unavailable', detail: `not recorded on ${snapshotDate}` };
    if (!plausible(spec.current, spec.bounds)) {
        implausible.push(spec.label);
        return { ...base, state: 'unavailable', detail: `${round(spec.current)} ${spec.unit} is outside the plausible range; ignored` };
    }
    if (spec.family === 'sleep' && spec.current < SLEEP_SCORE_ABSOLUTE_FLOOR) {
        return { ...base, state: 'adverse', detail: `${round(spec.current)} ${spec.unit} on ${snapshotDate}, below the absolute floor of ${SLEEP_SCORE_ABSOLUTE_FLOOR}` };
    }
    if (!isNum(spec.delta7d)) return { ...base, state: 'unavailable', detail: `${round(spec.current)} ${spec.unit} on ${snapshotDate}; no 7d baseline delta` };
    const band = Math.max(isNum(spec.sd28d) ? spec.sd28d : spec.sdFloor, spec.sdFloor);
    const where = `${round(spec.current)} ${spec.unit} on ${snapshotDate}, ${signed(spec.delta7d)} vs 7d (usual variation ±${round(band)})`;
    if (Math.abs(spec.delta7d) < band) return { ...base, state: 'reassuring', detail: `${where} — at baseline` };
    const adverse = spec.adverseSign * spec.delta7d > 0;
    return { ...base, state: adverse ? 'adverse' : 'reassuring', detail: `${where} — ${adverse ? 'adverse' : 'favorable'} vs baseline` };
}

/** Mirrors the subjective triggers of `rules.ts` `evaluateReadinessAndSafetyEnvelope` that
 * move a day off `train` (acuteSubjectiveModify, soreness > 6, overall physical load > 5). */
function subjectiveEngineTriggers(c: DailySubjectiveCheckin, physicalLoad: number | null): string[] {
    const hits: string[] = [];
    if (isNum(c.fatigue) && c.fatigue >= 8) hits.push(`fatigue ${c.fatigue}`);
    if (isNum(c.soreness) && c.soreness > 6) hits.push(`soreness ${c.soreness}`);
    if (isNum(c.readiness) && c.readiness <= 3) hits.push(`readiness ${c.readiness}`);
    if (isNum(c.mentalStress) && c.mentalStress >= 9) hits.push(`mental stress ${c.mentalStress}`);
    if (isNum(c.readiness) && isNum(c.fatigue) && c.readiness <= 4 && c.fatigue >= 6) hits.push(`readiness ${c.readiness} with fatigue ${c.fatigue}`);
    if (physicalLoad !== null && physicalLoad > 5) hits.push(`average physical load ${round(physicalLoad)}/10`);
    return hits;
}

function classifySubjective(checkin: DailySubjectiveCheckin | undefined, asOfDate: string): FamilyEvidence {
    const base = { family: 'subjective' as const, label: 'Athlete-reported state', kind: 'athlete_reported' as const };
    if (!checkin) return { ...base, state: 'unavailable', detail: `no check-in for ${asOfDate} — missing, not assumed favorable` };
    const physical = [
        checkin.fatigue, checkin.soreness,
        isNum(checkin.readiness) ? 10 - checkin.readiness : null,
        isNum(checkin.sleepQuality) ? 10 - checkin.sleepQuality : null,
    ].filter(isNum);
    const load = physical.length > 0 ? physical.reduce((a, b) => a + b, 0) / physical.length : null;
    const scores = `readiness ${round(checkin.readiness)}, fatigue ${round(checkin.fatigue)}, soreness ${round(checkin.soreness)}, `
        + `sleep quality ${round(checkin.sleepQuality)}, mental stress ${round(checkin.mentalStress)}`;
    if (load === null) return { ...base, state: 'unavailable', detail: `check-in ${asOfDate} has no readiness/fatigue/soreness/sleep answers` };
    const triggers = subjectiveEngineTriggers(checkin, load);
    if (triggers.length > 0) return { ...base, state: 'adverse', detail: `${scores} (${asOfDate}) — ${triggers.join('; ')}` };
    if (load <= SUBJECTIVE_REASSURING_MAX_LOAD) return { ...base, state: 'reassuring', detail: `${scores} (${asOfDate}) — low reported load` };
    return { ...base, state: 'neutral', detail: `${scores} (${asOfDate}) — mid-range, neither adverse nor reassuring` };
}

function safetyFactsFor(checkin: DailySubjectiveCheckin | undefined): string[] {
    if (!checkin) return [];
    const facts: string[] = [];
    if (checkin.redFlags?.present) facts.push(`clinical red flag reported${checkin.redFlags.categories?.length ? ` (${checkin.redFlags.categories.join(', ')})` : ''}`);
    if (checkin.illnessSymptoms) facts.push('illness symptoms reported today');
    if (checkin.painOrInjury) facts.push('pain/injury reported today');
    for (const [region, tr] of Object.entries(checkin.tissueResponses ?? {})) {
        if (!tr) continue;
        const levels = [['morning', tr.morningState], ['during training', tr.painDuringTraining], ['after training', tr.afterTrainingState], ['next morning', tr.nextMorningReaction]]
            .filter(([, level]) => level && level !== 'normal')
            .map(([when, level]) => `${level} ${when}`);
        if (levels.length > 0) facts.push(`tissue response ${region}: ${levels.join(', ')}`);
    }
    return facts;
}

function vendorContextFor(snapshot: DailyRecoverySnapshot): string[] {
    const { raw } = snapshot;
    const out: string[] = [];
    if (isNum(raw.bodyBatteryWake)) out.push(`Body Battery on waking ${raw.bodyBatteryWake}`);
    if (isNum(raw.stress?.avg)) out.push(`device stress avg ${raw.stress?.avg}`);
    if (isNum(raw.trainingReadiness?.score)) out.push(`Training Readiness ${raw.trainingReadiness?.score}`);
    if (raw.hrvStatus) out.push(`HRV status ${raw.hrvStatus}`);
    return out;
}

function baselineMaturity(snapshot: DailyRecoverySnapshot): RecoveryDataConfidence['baseline'] {
    if (snapshot.dataQuality?.baseline28dReady) return 'mature_28d';
    if (snapshot.dataQuality?.baseline7dReady) return 'partial_7d';
    return 'immature';
}

function objectiveFamilies(snapshot: DailyRecoverySnapshot | undefined, asOfDate: string, confidence: RecoveryDataConfidence): FamilyEvidence[] {
    const specs: Array<Pick<FamilyEvidence, 'family' | 'label'>> = [
        { family: 'hrv', label: 'HRV (overnight)' }, { family: 'rhr', label: 'Resting HR' }, { family: 'sleep', label: 'Sleep score' },
    ];
    const blocked = (detail: string): FamilyEvidence[] => specs.map(s => ({ ...s, kind: 'measured_core', state: 'unavailable', detail }));
    if (!snapshot) return blocked('no wearable snapshot in the exported window — missing, not normal');
    if (confidence.wearable === 'stale') return blocked(`latest snapshot is ${snapshot.date}, not ${asOfDate} — stale, not read as current recovery`);
    if (confidence.baseline === 'immature') return blocked('personal baseline not yet mature (<7 days) — deviations cannot be judged');
    const { raw, derived } = snapshot;
    const implausible = confidence.implausible;
    return [
        classifyObjective({ family: 'hrv', label: 'HRV (overnight)', unit: 'ms', current: raw.hrvOvernightAvg, delta7d: derived.deltas.hrvVs7d, sd28d: derived.hrv28dStdev, sdFloor: HRV_SD_FLOOR_MS, adverseSign: -1, bounds: PHYSIOLOGICAL_BOUNDS.hrv }, snapshot.date, implausible),
        classifyObjective({ family: 'rhr', label: 'Resting HR', unit: 'bpm', current: raw.restingHr, delta7d: derived.deltas.restingHrVs7d, sd28d: derived.restingHr28dStdev, sdFloor: RHR_SD_FLOOR_BPM, adverseSign: 1, bounds: PHYSIOLOGICAL_BOUNDS.rhr }, snapshot.date, implausible),
        classifyObjective({ family: 'sleep', label: 'Sleep score', unit: 'pts', current: raw.sleepScore, delta7d: derived.deltas.sleepScoreVs7d, sd28d: derived.sleepScore28dStdev, sdFloor: SLEEP_SD_FLOOR_PTS, adverseSign: -1, bounds: PHYSIOLOGICAL_BOUNDS.sleepScore }, snapshot.date, implausible),
    ];
}

function patternFor(families: readonly FamilyEvidence[]): RecoveryPattern {
    const judged = families.filter(f => f.state !== 'unavailable');
    const adverse = families.filter(f => f.state === 'adverse').length;
    const reassuring = families.filter(f => f.state === 'reassuring').length;
    if (judged.length < 2) return 'INSUFFICIENT';
    if (adverse >= 2 && reassuring === 0) return 'CONVERGENT_ADVERSE';
    if (reassuring >= 2 && adverse === 0) return 'CONVERGENT_REASSURING';
    return 'MIXED';
}

function uncertaintyFor(families: readonly FamilyEvidence[], confidence: RecoveryDataConfidence): string[] {
    const out: string[] = [];
    const adverse = families.filter(f => f.state === 'adverse');
    if (adverse.length === 1) out.push(`one isolated adverse signal (${adverse[0].label}) — not a multi-signal cluster`);
    if (confidence.wearable === 'missing') out.push('no wearable data — objective recovery unknown');
    if (confidence.wearable === 'stale') out.push(`wearable data stale (latest ${confidence.wearableDate})`);
    if (confidence.baseline === 'immature') out.push('personal baseline immature');
    if (confidence.baseline === 'partial_7d') out.push('28-day baseline not yet mature; usual-variation bands rest on partial history');
    if (confidence.subjective === 'missing') out.push('subjective check-in missing');
    if (confidence.implausible.length > 0) out.push(`implausible values ignored: ${confidence.implausible.join(', ')}`);
    const unavailableCore = families.filter(f => f.kind === 'measured_core' && f.state === 'unavailable').length;
    if (confidence.wearable === 'current' && confidence.baseline !== 'immature' && unavailableCore > 0) {
        out.push(`${unavailableCore} of 3 core wearable signals unavailable`);
    }
    return out;
}

function implicationsFor(pattern: RecoveryPattern, safetyFacts: readonly string[]): string[] {
    const out: string[] = [];
    if (safetyFacts.length > 0) out.push('current safety facts (pain, illness, tissue response, red flags) override this synthesis');
    if (pattern === 'CONVERGENT_ADVERSE') out.push('independent core signals agree on reduced recovery; the engine\'s readiness/safety evaluation decides the response');
    if (pattern === 'MIXED') out.push('no multi-signal adverse cluster supports an automatic downgrade; a single adverse signal alone does not justify redesigning future training');
    if (pattern === 'INSUFFICIENT') out.push('evidence is insufficient to characterize recovery; do not read missing or stale data as normal recovery');
    if (pattern === 'CONVERGENT_REASSURING' || pattern === 'MIXED') out.push('reassuring evidence never justifies raising volume or intensity above authored intent');
    out.push('explanatory only — not a readiness score; recommendations are unchanged by this summary');
    return out;
}

export function synthesizeRecoveryEvidence(input: {
    asOfDate: string;
    snapshots: readonly DailyRecoverySnapshot[];
    checkins: readonly DailySubjectiveCheckin[];
}): RecoveryEvidenceSynthesis {
    const { asOfDate } = input;
    const eligible = input.snapshots.filter(s => s.date <= asOfDate);
    const latest = eligible.reduce<DailyRecoverySnapshot | undefined>((best, s) => (!best || s.date > best.date ? s : best), undefined);
    const checkin = input.checkins.find(c => c.date === asOfDate);
    const confidence: RecoveryDataConfidence = {
        wearable: !latest ? 'missing' : latest.date === asOfDate ? 'current' : 'stale',
        wearableDate: latest?.date ?? null,
        baseline: latest ? baselineMaturity(latest) : 'unknown',
        subjective: checkin ? 'present' : 'missing',
        implausible: [],
    };
    const families = [classifySubjective(checkin, asOfDate), ...objectiveFamilies(latest, asOfDate, confidence)];
    const pattern = patternFor(families);
    const safetyFacts = safetyFactsFor(checkin);
    return {
        asOfDate,
        pattern,
        families,
        safetyFacts,
        vendorContext: latest && confidence.wearable === 'current' ? vendorContextFor(latest) : [],
        confidence,
        uncertainty: uncertaintyFor(families, confidence),
        implications: implicationsFor(pattern, safetyFacts),
    };
}

const BASELINE_LABEL: Record<RecoveryDataConfidence['baseline'], string> = {
    mature_28d: '28-day baseline mature',
    partial_7d: '7-day baseline only (28-day immature)',
    immature: 'baseline immature (<7 days)',
    unknown: 'baseline unknown',
};

export function renderRecoveryEvidenceSynthesis(s: RecoveryEvidenceSynthesis): string[] {
    const bullet = (items: readonly string[]): string[] => (items.length > 0 ? items.map(i => `  - ${i}`) : ['  - none']);
    const byState = (state: FamilyState) => s.families.filter(f => f.state === state).map(f => `${f.label}: ${f.detail}`);
    const { confidence: c } = s;
    const lines: string[] = [
        '### Recovery evidence synthesis (explanatory — not a readiness score, no decision authority)',
        '',
    ];
    if (s.safetyFacts.length > 0) lines.push(`**Dominant safety facts (override everything below):** ${s.safetyFacts.join('; ')}`);
    lines.push(`Recovery pattern (${s.asOfDate}): **${s.pattern}** — one vote per independent family (athlete-reported, HRV, resting HR, sleep); vendor composites do not vote.`);
    lines.push('- Adverse evidence:', ...bullet(byState('adverse')));
    lines.push('- Reassuring evidence:', ...bullet(byState('reassuring')));
    const other = [...byState('neutral'), ...byState('unavailable')];
    if (other.length > 0) lines.push('- Neutral / unavailable:', ...bullet(other));
    lines.push('- Conflicts / uncertainty:', ...bullet(s.uncertainty));
    lines.push(`- Data confidence (observability only): wearable ${c.wearable}${c.wearableDate ? ` (latest ${c.wearableDate})` : ''} · ${BASELINE_LABEL[c.baseline]} · check-in ${c.subjective}`);
    if (s.vendorContext.length > 0) lines.push(`- Vendor composites (correlated with the core signals; context only, not counted): ${s.vendorContext.join(' · ')}`);
    lines.push('- Decision implication:', ...bullet(s.implications));
    return lines;
}
