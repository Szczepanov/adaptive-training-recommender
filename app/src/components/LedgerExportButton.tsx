import { useEffect, useRef, useState } from 'react';
import type { LedgerPurpose } from '../ledger/export/schema';
import { downloadLedgerExportFile } from '../utils/contextBriefExport';

interface LedgerExportButtonProps {
    userId: string;
    asOfDate: string;
    purpose: LedgerPurpose;
    window?: { startDate: string; endDate: string };
}

export function LedgerExportButton({ userId, asOfDate, purpose, window }: LedgerExportButtonProps) {
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const mounted = useRef(true);
    const pending = useRef(false);

    useEffect(() => {
        mounted.current = true;
        return () => { mounted.current = false; };
    }, []);

    async function handleExport() {
        if (pending.current) return;
        pending.current = true;
        setBusy(true);
        setError(null);
        try {
            const { ledgerExportService } = await import('../services/ledgerExportService');
            if (!mounted.current) return;
            const ledger = await ledgerExportService.build(userId, { asOfDate, purpose, window });
            if (mounted.current) downloadLedgerExportFile(ledger);
        } catch {
            if (mounted.current) setError('Ledger export could not start. Try again.');
        } finally {
            if (mounted.current) {
                pending.current = false;
                setBusy(false);
            }
        }
    }

    return (
        <>
            <button type="button" className="brief-copy" disabled={busy} onClick={handleExport}>
                {busy ? 'Exporting ledger…' : 'Export ledger (JSON)'}
            </button>
            {error && <span role="status">{error}</span>}
        </>
    );
}
