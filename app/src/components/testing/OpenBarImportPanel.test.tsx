import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { AssessmentAttempt, MeasurementProtocol } from '../../observations/models';
import { CONCENTRIC_SEGMENTATION_V2 } from '../../observations/concentricSegmentation';
import { buildOpenBarAnalysis, openBarSingleRepProfile } from '../../observations/fixtures/openBarAnalysisFixtures';
import { parseOpenBarAnalysis } from '../../observations/openBarAnalysis';
import { proposeOpenBarTrial } from '../../observations/openBarAnalysisImport';
import { BACK_SQUAT_1RM_PROTOCOL_V2, STANDING_BROAD_JUMP_PROTOCOL } from '../../observations/physicalCapitalProtocols';
import { OpenBarImportPanel, OpenBarImportPreview } from './OpenBarImportPanel';
import { TrialCaptureTable } from './TrialCaptureTable';

const attempt: AssessmentAttempt = {
    id: 'openbar-attempt', protocolRef: { id: 'strength-back-squat-1rm', revision: 2 },
    scheduledDate: '2026-10-03', state: 'in_progress', purpose: 'baseline',
};
const availability = {
    protocol: BACK_SQUAT_1RM_PROTOCOL_V2,
    existingSourceRefs: new Set<string>(), existingSourceVideoHashes: new Set<string>(),
    storedOrdinals: new Set<number>(), occupiedOrdinals: new Set([1]), unavailableOrdinals: new Set<number>(),
};
function proposal(gapped = false) {
    const profile = gapped ? [...openBarSingleRepProfile(), ...openBarSingleRepProfile()] : openBarSingleRepProfile();
    const parsed = parseOpenBarAnalysis(JSON.stringify(buildOpenBarAnalysis(profile, gapped ? { dropSamples: [32, 33] } : {})), CONCENTRIC_SEGMENTATION_V2);
    const outcome = proposeOpenBarTrial({ fileName: 'squat.json', fileHash: 'b'.repeat(64), parsed }, new Set(), new Set());
    if (outcome.status !== 'proposed') throw new Error(outcome.rejection.reason);
    return outcome.proposal;
}
function previewHtml(load: string, overrides: Partial<typeof availability> = {}) {
    const p = proposal();
    return renderToStaticMarkup(<OpenBarImportPreview {...availability} {...overrides}
        preview={{ proposals: [p], rejections: [] }} loads={{ [p.sourceRef]: load }}
        onLoadChange={() => undefined} onApply={() => undefined} onClear={() => undefined} />);
}

describe('OpenBar import panel (#981)', () => {
    it('offers local JSON selection with accessible labels and no save side effects', () => {
        const onApply = vi.fn();
        const html = renderToStaticMarkup(<OpenBarImportPanel {...availability} attempt={attempt} onApply={onApply} />);
        expect(html).toContain('Import OpenBar analysis (JSON)');
        expect(html).toContain('accept=".json,application/json"');
        expect(html).toContain('Choose OpenBar analysis files');
        expect(html).toContain('Files stay on this phone');
        expect(html).toContain('nothing is saved until you press Save below');
        expect(onApply).not.toHaveBeenCalled();
    });
    it.each(['', '0', '501', 'not-a-number'])('disables Apply until a valid load is entered (%s)', load => {
        expect(previewHtml(load)).toMatch(/disabled=""[^>]*>Apply OpenBar/);
    });
    it('enables Apply for a valid athlete-entered kilogram load', () => {
        const html = previewHtml('100');
        expect(html).not.toMatch(/disabled=""[^>]*>Apply OpenBar/);
        expect(html).toContain('value="100"');
    });
    it('keeps a stale preview blocked after another import adds the same video', () => {
        const html = previewHtml('100', { existingSourceVideoHashes: new Set(['a'.repeat(64)]) });
        expect(html).toContain('already in the attempt');
        expect(html).toMatch(/disabled=""[^>]*>Apply OpenBar/);
    });
    it('shows excluded reps with an actionable tracking-gap note', () => {
        const p = proposal(true);
        const html = renderToStaticMarkup(<OpenBarImportPreview {...availability} preview={{ proposals: [p], rejections: [] }}
            loads={{}} onLoadChange={() => undefined} onApply={() => undefined} onClear={() => undefined} />);
        expect(html).toContain('Rep 1 not used: tracking gap');
        expect(html).toContain('selected rep 2');
    });
    it('shows rejected files as alerts and allows clearing a rejection-only preview', () => {
        const html = renderToStaticMarkup(<OpenBarImportPreview {...availability}
            preview={{ proposals: [], rejections: [{ fileName: 'bad.json', reason: 'Unsupported coordinate convention.' }] }}
            loads={{}} onLoadChange={() => undefined} onApply={() => undefined} onClear={() => undefined} />);
        expect(html).toContain('role="alert"');
        expect(html).toContain('Clear OpenBar preview');
        expect(html).not.toContain('Apply OpenBar to draft');
    });
    it('mounts only on open attempts with the velocity-field contract', () => {
        const table = (protocol: MeasurementProtocol, state: AssessmentAttempt['state']) => renderToStaticMarkup(
            <TrialCaptureTable userId="synthetic-user" protocol={protocol} attempt={{ ...attempt, state }}
                contextValues={{}} onContextChange={() => undefined} defaultDevice={{ provider: '' }} onDefaultDeviceChange={() => undefined}
                onSave={() => Promise.resolve()} saving={false} />,
        );
        expect(table(BACK_SQUAT_1RM_PROTOCOL_V2, 'in_progress')).toContain('Import OpenBar analysis');
        expect(table(BACK_SQUAT_1RM_PROTOCOL_V2, 'completed')).not.toContain('Import OpenBar analysis');
        expect(table(STANDING_BROAD_JUMP_PROTOCOL, 'in_progress')).not.toContain('Import OpenBar analysis');
    });
});
