import { useState } from 'react';
import '../components/testing/TestingWorkflow.css';
import { TrialCaptureTable } from '../components/testing/TrialCaptureTable';
import type { MetricObservationDevice } from '../observations/models';
import { BACK_SQUAT_1RM_PROTOCOL_V2, BACK_SQUAT_FIXED_LOAD_VELOCITY_PROTOCOL } from '../observations/physicalCapitalProtocols';
import { VISUAL_DATE, VISUAL_USER_ID } from './fixtures';

/** Real capture component with local-only synthetic assessment props. */
export function AssessmentVelocityImportHarness({ fixedLoad = false }: { fixedLoad?: boolean }) {
    const protocol = fixedLoad ? BACK_SQUAT_FIXED_LOAD_VELOCITY_PROTOCOL : BACK_SQUAT_1RM_PROTOCOL_V2;
    const [context, setContext] = useState<Record<string, string>>({ equipment_setup_id: 'synthetic-rack', ...(fixedLoad ? { test_load_kg: '60', measurement_method_id: 'manual' } : {}) });
    const [device, setDevice] = useState<MetricObservationDevice>({ provider: '' });
    return <div className="testing-workflow">
        <h2>Record assessment trials</h2>
        <TrialCaptureTable userId={VISUAL_USER_ID} protocol={protocol}
            attempt={{ id: fixedLoad ? 'visual-fixed-load-velocity' : 'visual-velocity-import', protocolRef: { id: protocol.id, revision: protocol.revision },
                state: 'in_progress', purpose: 'baseline', scheduledDate: VISUAL_DATE }}
            contextValues={context} onContextChange={setContext} defaultDevice={device} onDefaultDeviceChange={setDevice}
            onSave={() => Promise.resolve()} saving={false} />
    </div>;
}
