import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
    MAX_CAPTURE_FIELDS,
    MAX_CAPTURE_REDUCERS,
    MAX_CAPTURE_TRIALS,
} from './assessmentCapture';
import { MAX_TRIAL_CORRECTIONS } from './assessmentTrials';
import { FIXED_LOAD_VELOCITY_DIMENSIONS, FIXED_LOAD_VELOCITY_METRIC_ID } from './fixedLoadVelocity';
import { listComparisonDimensionIds } from './protocols';
import { listMetricDefinitions } from './registry';
import { MAX_ATHLETE_EVIDENCE_LINEAGE_REFS } from '../engine/knowledgeLineage';

type PersistedRecommendationAuditKey =
    keyof import('../engine/provenance').RecommendationAuditWithSubjectiveDrift;

const RECOMMENDATION_AUDIT_KEYS = [
    'policyVersion',
    'evaluatedAt',
    'decisionContextRevision',
    'decisionContext',
    'safetyStatus',
    'history',
    'envelope',
    'plannedDose',
    'executionDose',
    'candidateScores',
    'droppedContributorObjectives',
    'externalPlan',
    'externalRest',
    'authoredOccurrence',
    'primarySession',
    'additionalSessions',
    'subjectiveDrift',
    'identityDecision',
    'knowledgeLineage',
    'athleteEvidenceLineage',
    'development',
    'season',
] as const satisfies readonly PersistedRecommendationAuditKey[];

const AUDIT_KEYS_ARE_EXHAUSTIVE: Exclude<
    PersistedRecommendationAuditKey,
    typeof RECOMMENDATION_AUDIT_KEYS[number]
> extends never ? true : never = true;

function loadRules(): string {
    const candidatePaths = [
        resolve(process.cwd(), 'firestore.rules'),
        resolve(__dirname, '../../firestore.rules'),
    ];
    for (const p of candidatePaths) {
        try {
            return readFileSync(p, 'utf8');
        } catch {
            // try next
        }
    }
    throw new Error('Unable to locate firestore.rules');
}

describe('Firestore rules parity with TypeScript domain models', () => {
    const rules = loadRules();

    // Issue #1201: metric ids/units, comparison-dimension ids and the supported reducer version
    // are validated only by TypeScript (registry.ts, protocols.ts, assessmentCapture.ts) on the
    // write path; their tests live in registry.test.ts, comparability.test.ts and
    // assessmentCapture.test.ts. Guard against the rules re-acquiring a drifting copy: the only
    // registry ids the rules may name are the fixed-load benchmark metric and its series-defining
    // dimensions, which the rules need for the immutable source-trial binding (ADR-0053 X).
    it('names no metric or comparison-dimension id other than the fixed-load binding ones', () => {
        const allowed = new Set<string>([FIXED_LOAD_VELOCITY_METRIC_ID, ...FIXED_LOAD_VELOCITY_DIMENSIONS]);
        const ids = [...listMetricDefinitions().map(({ id }) => id), ...listComparisonDimensionIds()];
        expect(ids).toEqual(expect.arrayContaining([...allowed]));
        const leaked = ids.filter(id => !allowed.has(id) && rules.includes(id));
        expect(leaked).toEqual([]);
        expect(rules).not.toMatch(/capture\.reducerVersion\s*==/);
    });

    it('keeps capture and trial numeric bounds in parity with TypeScript constants', () => {
        // capture.maxTrials <= MAX_CAPTURE_TRIALS
        const maxTrialsMatch = rules.match(/capture\.maxTrials\s*<=\s*(\d+)/);
        expect(maxTrialsMatch).not.toBeNull();
        expect(Number.parseInt(maxTrialsMatch![1], 10)).toBe(MAX_CAPTURE_TRIALS);

        // capture.fields.size() <= MAX_CAPTURE_FIELDS
        const fieldsMatch = rules.match(/capture\.fields\.size\(\)\s*<=\s*(\d+)/);
        expect(fieldsMatch).not.toBeNull();
        expect(Number.parseInt(fieldsMatch![1], 10)).toBe(MAX_CAPTURE_FIELDS);

        // capture.reducers.size() <= MAX_CAPTURE_REDUCERS
        const reducersMatch = rules.match(/capture\.reducers\.size\(\)\s*<=\s*(\d+)/);
        expect(reducersMatch).not.toBeNull();
        expect(Number.parseInt(reducersMatch![1], 10)).toBe(MAX_CAPTURE_REDUCERS);

        // data.correctionIndex <= MAX_TRIAL_CORRECTIONS
        const correctionsMatch = rules.match(/data\.correctionIndex\s*<=\s*(\d+)/);
        expect(correctionsMatch).not.toBeNull();
        expect(Number.parseInt(correctionsMatch![1], 10)).toBe(MAX_TRIAL_CORRECTIONS);

        // data.values.size() <= MAX_CAPTURE_FIELDS in trial rule
        const trialValuesMatch = rules.match(/data\.values\s*is\s*map\s*&&\s*data\.values\.size\(\)\s*<=\s*(\d+)/);
        expect(trialValuesMatch).not.toBeNull();
        expect(Number.parseInt(trialValuesMatch![1], 10)).toBe(MAX_CAPTURE_FIELDS);
    });

    it('keeps hasValidSessionReferenceBinding keys in parity with SessionReferenceBinding', () => {
        const bindingMatch = rules.match(/function hasValidSessionReferenceBinding\(binding\)\s*\{[\s\S]*?binding\.keys\(\)\.hasOnly\(\[([\s\S]*?)\]\)/);
        expect(bindingMatch).not.toBeNull();

        const rulesKeys = bindingMatch![1]
            .split(',')
            .map(s => s.trim().replace(/^'|'$/g, ''))
            .filter(s => s.length > 0)
            .sort();

        const expectedKeys: Array<keyof import('../sessions/models').SessionReferenceBinding> = [
            'sessionSource',
            'occurrenceId',
            'prescriptionHash',
            'executedDefinition',
            'fitWorkoutFingerprint',
            'fitWorkoutFingerprintKind',
        ];

        expect(rulesKeys).toEqual([...expectedKeys].sort());
    });

    it('keeps RecommendationAudit keys and athlete-evidence bound in parity with TypeScript', () => {
        const auditMatch = rules.match(
            /function hasValidRecommendationAudit\(userId, audit, version, date, revision\)\s*\{[\s\S]*?audit\.keys\(\)\.hasOnly\(\[([\s\S]*?)\]\)/,
        );
        expect(auditMatch).not.toBeNull();

        const rulesKeys = auditMatch![1]
            .split(',')
            .map(s => s.trim().replace(/^'|'$/g, ''))
            .filter(s => s.length > 0)
            .sort();

        expect(AUDIT_KEYS_ARE_EXHAUSTIVE).toBe(true);
        expect(rulesKeys).toEqual([...RECOMMENDATION_AUDIT_KEYS].sort());

        const athleteLineageMatch = rules.match(
            /function hasValidAthleteEvidenceLineage\(lineage\)\s*\{[\s\S]*?lineage\.size\(\)\s*<=\s*(\d+)/,
        );
        expect(athleteLineageMatch).not.toBeNull();
        expect(Number.parseInt(athleteLineageMatch![1], 10)).toBe(MAX_ATHLETE_EVIDENCE_LINEAGE_REFS);
    });
});
