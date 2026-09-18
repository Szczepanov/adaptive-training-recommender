import type { ShadowLogResult } from '../services/shadowLogService';
import { addDaysToLocalDateString } from './localDate';

export interface DecisionJournalEvidenceExportRequest {
    lock: { current: boolean };
    userId: string;
    date: string;
    build: (userId: string, startDate: string, endDateInclusive: string) => Promise<ShadowLogResult>;
    download: (result: ShadowLogResult) => void;
    setExporting: (value: boolean) => void;
    setStatus: (value: string | null) => void;
}

/** The Decision Journal export action is independently testable so two rapid clicks cannot
 * bypass the in-flight lock before React has rendered the disabled button. */
export async function exportDecisionJournalEvidenceOnce(request: DecisionJournalEvidenceExportRequest): Promise<boolean> {
    if (request.lock.current) return false;
    request.lock.current = true;
    request.setExporting(true);
    request.setStatus(null);
    try {
        const result = await request.build(request.userId, addDaysToLocalDateString(request.date, -41), request.date);
        request.download(result);
        request.setStatus('Downloaded the private evidence CSV and aggregate readout manifest.');
        return true;
    } catch {
        request.setStatus('Could not export the shadow evidence. Retry when the data connection is available.');
        return false;
    } finally {
        request.lock.current = false;
        request.setExporting(false);
    }
}
