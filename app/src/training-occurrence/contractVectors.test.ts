import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { providerActivitySourceKey, encodeSourceKeyForDocId } from './sourceIdentity';
import { normalizedGarminModality } from '../sessions/occurrenceReconciliation';

interface SourceIdentityVector {
    description: string;
    provider?: string;
    activityId?: string;
    rawKey?: string;
    expectedSourceKey: string;
    expectedDocId: string;
}

interface ModalityVector {
    activityType: string;
    expectedModality: string | null;
}

interface ContractFixture {
    schemaVersion: number;
    sourceIdentityVectors: SourceIdentityVector[];
    modalityVectors: ModalityVector[];
}

describe('training_occurrence_contract_vectors.json parity', () => {
    const fixturePath = resolve(__dirname, '../../../tests/fixtures/training_occurrence_contract_vectors.json');
    const fixture: ContractFixture = JSON.parse(readFileSync(fixturePath, 'utf8'));

    it('matches all source identity vectors', () => {
        for (const vector of fixture.sourceIdentityVectors) {
            const key = vector.rawKey ?? providerActivitySourceKey(vector.provider!, vector.activityId!);
            expect(key, `${vector.description}: source key mismatch`).toBe(vector.expectedSourceKey);
            const docId = encodeSourceKeyForDocId(key);
            expect(docId, `${vector.description}: docId mismatch`).toBe(vector.expectedDocId);
        }
    });

    it('matches all modality classification vectors', () => {
        for (const vector of fixture.modalityVectors) {
            const modality = normalizedGarminModality(vector.activityType);
            expect(modality, `modality mismatch for ${vector.activityType}`).toBe(vector.expectedModality);
        }
    });
});
