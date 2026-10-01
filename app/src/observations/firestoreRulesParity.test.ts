import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
    ASSESSMENT_REDUCER_VERSION_V1,
    MAX_CAPTURE_FIELDS,
    MAX_CAPTURE_REDUCERS,
    MAX_CAPTURE_TRIALS,
} from './assessmentCapture';
import { MAX_TRIAL_CORRECTIONS } from './assessmentTrials';
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

    it('keeps outcomeMetricUnits() in parity with listMetricDefinitions() id->unit map', () => {
        const metricBlockMatch = rules.match(/function outcomeMetricUnits\(\)\s*\{[\s\S]*?return\s*\{([\s\S]*?)\};[\s\S]*?\}/);
        expect(metricBlockMatch).not.toBeNull();

        const lines = metricBlockMatch![1].split('\n');
        const rulesMetrics: Record<string, string> = {};
        for (const line of lines) {
            const pairMatch = line.match(/'([^']+)':\s*'([^']+)'/);
            if (pairMatch) {
                rulesMetrics[pairMatch[1]] = pairMatch[2];
            }
        }

        const domainMetrics: Record<string, string> = Object.fromEntries(
            listMetricDefinitions().map(def => [def.id, def.unit]),
        );

        expect(rulesMetrics).toEqual(domainMetrics);
    });

    it('keeps comparisonDimensionIds() in parity with protocols.ts dimension ids', () => {
        const dimBlockMatch = rules.match(/function comparisonDimensionIds\(\)\s*\{[\s\S]*?return\s*\[([\s\S]*?)\];[\s\S]*?\}/);
        expect(dimBlockMatch).not.toBeNull();

        const rawElements = dimBlockMatch![1]
            .split(',')
            .map(s => s.trim().replace(/^'|'$/g, ''))
            .filter(s => s.length > 0);

        const domainDims = listComparisonDimensionIds();
        expect(rawElements).toEqual([...domainDims]);
    });

    it('keeps the assessment reducer version literal in parity with ASSESSMENT_REDUCER_VERSION_V1', () => {
        const versionMatch = rules.match(/capture\.reducerVersion\s*==\s*'([^']+)'/);
        expect(versionMatch).not.toBeNull();
        expect(versionMatch![1]).toBe(ASSESSMENT_REDUCER_VERSION_V1);
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
