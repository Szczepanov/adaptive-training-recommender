import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildLedgerExport } from '../ledger/export/buildLedgerExport';
import { fullInput } from '../ledger/export/ledgerExportFixtures.testSupport';
import { ENGINE_OPINION_KEYS, LEDGER_EXPORT_SCHEMA_VERSION } from '../ledger/export/schema';

const mocks = vi.hoisted(() => ({
    getPreferencesState: vi.fn(),
    getRecommendationsInRange: vi.fn(),
    getProfileState: vi.fn(),
}));

vi.mock('./preferencesService', () => ({
    preferencesService: { getPreferencesState: mocks.getPreferencesState },
}));
vi.mock('./recommendationService', () => ({
    recommendationService: { getRecommendationsInRange: mocks.getRecommendationsInRange },
}));
vi.mock('./trainingIntentProfileService', () => ({
    trainingIntentProfileService: { getProfileState: mocks.getProfileState },
}));

import { ContextBriefService } from './contextBriefService';

describe('ContextBriefService ledger mode (#1167 P2-6, OD4, OD5)', () => {
    beforeEach(() => {
        vi.resetAllMocks();
    });

    it('renders the Markdown brief from LedgerExport in ledger mode without engine opinions or recommendation reads', async () => {
        mocks.getPreferencesState.mockResolvedValue({
            status: 'AVAILABLE',
            data: { engineRecommendationsEnabled: false },
        });
        const ledgerExporter = {
            build: vi.fn(async (_userId: string, request: { asOfDate: string; purpose: 'morning' | 'planning' | 'diagnostic'; exportedAt?: string; legacyEngine?: Record<string, unknown> }) =>
                buildLedgerExport(fullInput({
                    asOfDate: request.asOfDate,
                    purpose: request.purpose,
                    exportedAt: request.exportedAt ?? '2026-11-20T06:12:03Z',
                    ...(request.legacyEngine ? { legacyEngine: request.legacyEngine } : {}),
                })),
            ),
        };

        const service = new ContextBriefService(ledgerExporter);
        const result = await service.build('u1', '2026-11-20', 14, 'full', undefined, {
            exportedAt: '2026-11-20T06:12:03Z',
        });

        expect(ledgerExporter.build).toHaveBeenCalledWith('u1', {
            asOfDate: '2026-11-20',
            purpose: 'planning',
            window: { startDate: '2026-11-07', endDate: '2026-11-20' },
            exportedAt: '2026-11-20T06:12:03Z',
        });
        expect(mocks.getRecommendationsInRange).not.toHaveBeenCalled();
        expect(mocks.getProfileState).not.toHaveBeenCalled();
        expect(result.contractVersion).toBe(LEDGER_EXPORT_SCHEMA_VERSION);
        expect(result.purpose).toBe('planning');
        expect(result.startDate).toBe('2026-11-07');
        expect(result.asOfDate).toBe('2026-11-20');
        expect(result.windowDays).toBe(14);
        expect(result.unavailableSources).toEqual(['flag_evaluations']);
        expect(result.text).toContain('# Ledger export');
        expect(result.text).not.toContain('## Legacy engine (opt-in opinions)');
        for (const key of ENGINE_OPINION_KEYS) {
            expect(result.text).not.toContain(key);
        }
    });

    it('produces deterministic Markdown output in ledger mode for identical inputs apart from exportedAt', async () => {
        mocks.getPreferencesState.mockResolvedValue({
            status: 'AVAILABLE',
            data: { engineRecommendationsEnabled: false },
        });
        const ledgerExporter = {
            build: vi.fn(async (_userId: string, request: { asOfDate: string; purpose: 'morning' | 'planning' | 'diagnostic'; exportedAt?: string }) =>
                buildLedgerExport(fullInput({
                    asOfDate: request.asOfDate,
                    purpose: request.purpose,
                    exportedAt: request.exportedAt ?? '2026-11-20T06:12:03Z',
                })),
            ),
        };
        const service = new ContextBriefService(ledgerExporter);

        const first = await service.build('u1', '2026-11-20', 14, 'full', undefined, { exportedAt: '2026-11-20T06:12:03Z' });
        const second = await service.build('u1', '2026-11-20', 14, 'full', undefined, { exportedAt: '2026-11-20T06:12:03Z' });
        const later = await service.build('u1', '2026-11-20', 14, 'full', undefined, { exportedAt: '2030-01-01T00:00:00Z' });

        expect(second.text).toBe(first.text);
        expect(later.text.replace('2030-01-01T00:00:00Z', '2026-11-20T06:12:03Z')).toBe(first.text);
    });

    it('includes opt-in legacyEngine opinions only under the legacy section when explicitly requested (OD4)', async () => {
        mocks.getPreferencesState.mockResolvedValue({
            status: 'AVAILABLE',
            data: { engineRecommendationsEnabled: false },
        });
        const ledgerExporter = {
            build: vi.fn(async (_userId: string, request: { asOfDate: string; purpose: 'morning' | 'planning' | 'diagnostic'; exportedAt?: string; legacyEngine?: Record<string, unknown> }) =>
                buildLedgerExport(fullInput({
                    asOfDate: request.asOfDate,
                    purpose: request.purpose,
                    exportedAt: request.exportedAt ?? '2026-11-20T06:12:03Z',
                    ...(request.legacyEngine ? { legacyEngine: request.legacyEngine } : {}),
                })),
            ),
        };
        const service = new ContextBriefService(ledgerExporter);

        const result = await service.build('u1', '2026-11-20', 14, 'full', undefined, {
            exportedAt: '2026-11-20T06:12:03Z',
            legacyEngine: { policyVersion: '1.2.3', recommendation: { modality: 'cycling' } },
        });

        expect(result.text).toContain('## Legacy engine (opt-in opinions)');
        expect(result.text).toContain('policyVersion');
        expect(result.text).toContain('1.2.3');
    });
});
