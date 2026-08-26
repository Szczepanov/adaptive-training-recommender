/* eslint-disable @typescript-eslint/no-explicit-any -- fixture is loosely-typed JSON manipulated ad hoc per test case, matching engine/validationCore.ts's own convention */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { validateIngestionSnapshotContract, validateNormalizedActivityContract } from './ingestionSnapshotContract';
import { parseRecoverySnapshot } from '../persistence/parsers/decisionInputs';

// Read (not `import ... .json`) so these shared cross-language fixtures -- which live
// outside app/'s tsconfig `include` -- don't need `resolveJsonModule` or a rootDir
// carve-out just to be loaded by a test. The same files are loaded by
// tests/test_contracts_ingestion.py on the Python side, so editing one field here
// without updating the Python dataclass fixture fails both suites, not neither.
function readFixture(relativePath: string): any {
    const fixturePath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), relativePath);
    return JSON.parse(readFileSync(fixturePath, 'utf-8'));
}

const validSnapshot = readFixture('../../../tests/fixtures/contracts/ingestion_snapshot.json');
const activityFixture = readFixture('../../../tests/fixtures/contracts/normalized_activity.json');

describe('IngestionSnapshotContract', () => {
    it('passes valid snapshot contract validation and parser', () => {
        const contractResult = validateIngestionSnapshotContract(validSnapshot);
        expect(contractResult.valid).toBe(true);
        expect(contractResult.errors).toEqual([]);

        const parseResult = parseRecoverySnapshot(validSnapshot, 'users/athlete-1/daily_recovery_snapshots/2026-08-26', 'athlete-1', '2026-08-26');
        expect(parseResult.status).toBe('AVAILABLE');
    });

    it('rejects invalid schema version', () => {
        const invalid = { ...validSnapshot, source: { ...validSnapshot.source, sourceSchemaVersion: 1 } };
        const result = validateIngestionSnapshotContract(invalid);
        expect(result.valid).toBe(false);
        expect(result.errors).toContain('sourceSchemaVersion must be 2 or 3, got 1');
    });

    it('rejects out-of-range sleep score or negative steps', () => {
        const invalid = {
            ...validSnapshot,
            raw: { ...validSnapshot.raw, sleepScore: 120, totalSteps: -50 },
        };
        const result = validateIngestionSnapshotContract(invalid);
        expect(result.valid).toBe(false);
        expect(result.errors).toContain('raw.sleepScore must be null or [0, 100]');
        expect(result.errors).toContain('raw.totalSteps must be null or non-negative number');
    });

    it('validates the normalized activity record produced by the Python mapper', () => {
        const result = validateNormalizedActivityContract(activityFixture.normalized);
        expect(result.valid).toBe(true);
        expect(result.errors).toEqual([]);
    });
});
