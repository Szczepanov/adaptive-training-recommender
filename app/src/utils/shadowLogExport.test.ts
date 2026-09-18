import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { downloadShadowEvidence } from './shadowLogExport';
import type { ShadowLogResult } from '../services/shadowLogService';

const blobs: Array<{ content: string; type: string }> = [];
const links: Array<{ href: string; download: string; click: ReturnType<typeof vi.fn> }> = [];

class TestBlob {
    constructor(parts: unknown[], options: { type: string }) {
        blobs.push({ content: parts.join(''), type: options.type });
    }
}

function result(): ShadowLogResult {
    return {
        startDate: '2026-08-01',
        endDate: '2026-08-02',
        unavailableSources: ['subjective check-ins (range unavailable)'],
        sourceQuality: { subjectiveCheckins: { status: 'UNAVAILABLE', issueCount: 0 } },
        rows: [{
            date: '2026-08-01', engineVerdict: 'proceed', engineMode: 'train', externalVerdict: 'proceed',
            externalNote: 'private operator note', sawEngineVerdictFirst: false, actualVerdict: null,
            adherenceFollowed: null, actualDurationMin: null, agreement: 'agree', subjectiveComplete: null,
            subjective: null, objective: null, policyVersion: 'policy-a', externalPlanContentHash: null,
            athleteDecisionAction: null, athleteDecisionReasons: null, regretClass: null, regretConfidence: null,
            athleteDeclaredRegret: null, utilityScore: null, coachingHelpfulness: null,
        }],
    };
}

describe('downloadShadowEvidence', () => {
    beforeEach(() => {
        blobs.length = 0;
        links.length = 0;
        vi.stubGlobal('Blob', TestBlob);
        vi.stubGlobal('URL', {
            createObjectURL: vi.fn(() => `blob:test-${links.length}`),
            revokeObjectURL: vi.fn(),
        });
        vi.stubGlobal('document', {
            createElement: vi.fn(() => {
                const link = { href: '', download: '', click: vi.fn() };
                links.push(link);
                return link;
            }),
            body: { appendChild: vi.fn(), removeChild: vi.fn() },
        });
    });

    afterEach(() => vi.unstubAllGlobals());

    it('downloads a CSV and aggregate-only manifest without user identifiers', () => {
        downloadShadowEvidence(result());

        expect(links.map(link => link.download)).toEqual([
            'shadow-evidence_2026-08-01_to_2026-08-02.csv',
            'shadow-evidence_2026-08-01_to_2026-08-02.readout.json',
        ]);
        expect(links.every(link => link.click.mock.calls.length === 1)).toBe(true);
        expect(blobs[0].content).toContain('private operator note');
        const manifest = JSON.parse(blobs[1].content) as Record<string, unknown>;
        expect(manifest).toMatchObject({
            schemaVersion: 1,
            startDate: '2026-08-01',
            endDate: '2026-08-02',
            unavailableSources: ['subjective check-ins (range unavailable)'],
            sourceQuality: { subjectiveCheckins: { status: 'UNAVAILABLE', issueCount: 0 } },
        });
        expect(JSON.stringify(manifest)).not.toContain('private operator note');
        expect(blobs.map(blob => blob.content).join('\n')).not.toContain('userId');
    });
});
