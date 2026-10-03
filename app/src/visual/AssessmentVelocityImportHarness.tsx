import { useState } from 'react';
import '../components/testing/TestingWorkflow.css';
import { TrialCaptureTable } from '../components/testing/TrialCaptureTable';
import type { MetricObservationDevice } from '../observations/models';
import { BACK_SQUAT_1RM_PROTOCOL_V2 } from '../observations/physicalCapitalProtocols';
import { VISUAL_DATE, VISUAL_USER_ID } from './fixtures';

/** Real capture component with local-only synthetic assessment props. */
export function AssessmentVelocityImportHarness() {
    const [context, setContext] = useState<Record<string, string>>({ equipment_setup_id: 'synthetic-rack' });
    const [device, setDevice] = useState<MetricObservationDevice>({ provider: '' });
    return <div className="testing-workflow">
        <h2>Record assessment trials</h2>
        <TrialCaptureTable userId={VISUAL_USER_ID} protocol={BACK_SQUAT_1RM_PROTOCOL_V2}
            attempt={{ id: 'visual-velocity-import', protocolRef: { id: BACK_SQUAT_1RM_PROTOCOL_V2.id, revision: 2 },
                state: 'in_progress', purpose: 'baseline', scheduledDate: VISUAL_DATE }}
            contextValues={context} onContextChange={setContext} defaultDevice={device} onDefaultDeviceChange={setDevice}
            onSave={() => Promise.resolve()} saving={false} />
    </div>;
}
