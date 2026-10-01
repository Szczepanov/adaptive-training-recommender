import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { AssessmentAttempt } from '../../observations/models';
import {
    BACK_SQUAT_1RM_PROTOCOL_V2,
    STANDING_BROAD_JUMP_PROTOCOL,
} from '../../observations/physicalCapitalProtocols';
import { TrialCaptureTable } from './TrialCaptureTable';
import { WlAnalysisImportPanel } from './WlAnalysisImportPanel';

function attempt(state: AssessmentAttempt['state']): AssessmentAttempt {
    return {
        id: 'att-1',
        protocolRef: { id: 'strength-back-squat-1rm', revision: 2 },
        scheduledDate: '2025-02-03',
        state,
        purpose: 'baseline',
    };
}

describe('WlAnalysisImportPanel', () => {
    it('offers CSV file selection with phone-friendly copy and no save side effects', () => {
        const html = renderToStaticMarkup(
            <WlAnalysisImportPanel
                protocol={BACK_SQUAT_1RM_PROTOCOL_V2}
                attempt={attempt('in_progress')}
                sessionDate="2025-02-03"
                existingSourceRefs={new Set()}
                storedOrdinals={new Set()}
                occupiedOrdinals={new Set([1])}
                onApply={() => undefined}
            />,
        );
        expect(html).toContain('Import WL Analysis CSV');
        expect(html).toContain('Choose WL Analysis CSV files');
        expect(html).toContain('att-1');
        expect(html).toContain('nothing is saved until you press Save below');
    });
});

describe('TrialCaptureTable WL import scope (D7)', () => {
    function tableHtml(protocol: typeof BACK_SQUAT_1RM_PROTOCOL_V2, state: AssessmentAttempt['state']): string {
        return renderToStaticMarkup(
            <TrialCaptureTable
                userId="user-1"
                protocol={protocol}
                attempt={attempt(state)}
                contextValues={{}}
                onContextChange={() => undefined}
                defaultDevice={{ provider: '' }}
                onDefaultDeviceChange={() => undefined}
                onSave={() => Promise.resolve()}
                saving={false}
            />,
        );
    }

    it('mounts the importer for an open velocity-capable attempt', () => {
        expect(tableHtml(BACK_SQUAT_1RM_PROTOCOL_V2, 'in_progress')).toContain('Import WL Analysis CSV');
    });

    it('hides the importer after completion and on protocols without velocity fields', () => {
        expect(tableHtml(BACK_SQUAT_1RM_PROTOCOL_V2, 'completed')).not.toContain('Import WL Analysis CSV');
        expect(tableHtml(STANDING_BROAD_JUMP_PROTOCOL, 'in_progress')).not.toContain('Import WL Analysis CSV');
    });

    it('keeps the existing save path untouched', () => {
        const onSave = vi.fn(() => Promise.resolve());
        const html = renderToStaticMarkup(
            <TrialCaptureTable
                userId="user-1"
                protocol={BACK_SQUAT_1RM_PROTOCOL_V2}
                attempt={attempt('in_progress')}
                contextValues={{}}
                onContextChange={() => undefined}
                defaultDevice={{ provider: '' }}
                onDefaultDeviceChange={() => undefined}
                onSave={onSave}
                saving={false}
            />,
        );
        expect(html).toContain('Save assessment trials');
        expect(onSave).not.toHaveBeenCalled();
    });
});
