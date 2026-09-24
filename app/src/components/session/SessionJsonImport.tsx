import React, { useCallback, useState } from 'react';
import type { SessionDefinition } from '../../sessions/models';
import { validateSessionDefinition } from '../../sessions/validation';
import { SessionDefinitionPreview } from './SessionDefinitionPreview';
import { type PreparedSessionLaunch, SessionDestinationSheet } from './SessionDestinationSheet';
import { SESSION_AI_PROMPT_TEMPLATE, unwrapSingleSessionFromPlanEnvelope } from './sessionJsonImportHelpers';
import './ManualSessionBuilder.css';

interface SessionJsonImportProps {
    userId: string;
    onClose: () => void;
    onStartExecution: (session: PreparedSessionLaunch) => void;
}

/** Imports normalized SessionDefinition (schemaVersion: 1), Canonical Workout Export (canonical_workout_v1), or a 1-session External Plan envelope. */
export const SessionJsonImport: React.FC<SessionJsonImportProps> = ({ userId, onClose, onStartExecution }) => {
    const [json, setJson] = useState('');
    const [definition, setDefinition] = useState<SessionDefinition | null>(null);
    const [importedSourceFormat, setImportedSourceFormat] = useState<'canonical_workout_v1' | 'external_plan_single_session' | 'session_definition' | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [showDestination, setShowDestination] = useState(false);
    const [promptCopied, setPromptCopied] = useState(false);

    const handleCopyPrompt = useCallback(async () => {
        try {
            await navigator.clipboard.writeText(SESSION_AI_PROMPT_TEMPLATE);
            setPromptCopied(true);
            setTimeout(() => setPromptCopied(false), 2000);
        } catch {
            // Clipboard permission fallback
        }
    }, []);

    const review = () => {
        try {
            const raw: unknown = JSON.parse(json);
            const unwrapped = unwrapSingleSessionFromPlanEnvelope(raw);

            if (unwrapped.multiSessionCount !== undefined) {
                setDefinition(null);
                setImportedSourceFormat(null);
                setError(
                    `This JSON is a multi-session External Training Plan (${unwrapped.multiSessionCount} sessions). ` +
                    'Import multi-week/multi-session plans via External Plan Import, or paste a single SessionDefinition (schemaVersion: 1).',
                );
                return;
            }

            const result = validateSessionDefinition(unwrapped.target);
            if (!result.ok) {
                setDefinition(null);
                setImportedSourceFormat(null);
                setError(result.issues.map(issue => `${issue.path}: ${issue.message}`).join('\n'));
                return;
            }
            setError(null);
            setImportedSourceFormat(unwrapped.sourceFormat);
            setDefinition(result.value);
        } catch (err: unknown) {
            setDefinition(null);
            setImportedSourceFormat(null);
            setError(err instanceof Error ? `Invalid JSON: ${err.message}` : 'Invalid JSON');
        }
    };

    return (
        <div className="manual-session-builder">
            <header className="builder-header">
                <div><h2>Import session JSON</h2><p>Paste a normalized session definition or exported workout JSON, then review every block before saving or starting it.</p></div>
                <button type="button" className="close-builder-btn" onClick={onClose} aria-label="Close import">×</button>
            </header>
            <div className="builder-form">
                <div className="form-group">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                        <label htmlFor="session-json">Session definition or Workout Export JSON</label>
                        <button
                            type="button"
                            className="secondary-btn"
                            onClick={handleCopyPrompt}
                            style={{ fontSize: '0.85rem', padding: '4px 10px' }}
                        >
                            {promptCopied ? '✓ Copied AI prompt' : 'Copy AI prompt to generate session JSON'}
                        </button>
                    </div>
                    <textarea id="session-json" value={json} onChange={event => setJson(event.target.value)} rows={18} spellCheck={false} placeholder={'{\n  "schemaVersion": 1,\n  "id": "my-session",\n  "revision": 1,\n  "title": "…",\n  "intent": "training",\n  "blocks": […]\n}\n\n// Or paste workout export JSON (canonical_workout_v1)'} />
                </div>
                <p className="builder-help">The importer accepts Session Definitions (<code>schemaVersion: 1</code>), Workout Exports (<code>canonical_workout_v1</code>), and single-session External Plan envelopes. Use <strong>Copy AI prompt to generate session JSON</strong> to give an external AI advisor the exact schema and exercise IDs.</p>
                {importedSourceFormat === 'canonical_workout_v1' && (
                    <p className="builder-help" style={{ color: 'var(--color-primary-dark, #2b6cb0)' }}>
                        ✓ Converted from Workout Export format (<code>canonical_workout_v1</code>) into a normalized Session Definition.
                    </p>
                )}
                {importedSourceFormat === 'external_plan_single_session' && (
                    <p className="builder-help" style={{ color: 'var(--color-primary-dark, #2b6cb0)' }}>
                        ✓ Extracted <code>SessionDefinition</code> from the single-session External Plan envelope.
                    </p>
                )}
                {error && <pre className="destination-error-box" role="alert">{error}</pre>}
                <div className="builder-actions"><button type="button" className="save-and-proceed-btn" onClick={review}>Validate & preview</button></div>
            </div>
            {definition && <SessionDefinitionPreview definition={definition} onChooseDestination={() => setShowDestination(true)} />}
            {definition && <SessionDestinationSheet userId={userId} definition={definition} isOpen={showDestination} onClose={() => setShowDestination(false)} onStartExecution={onStartExecution} onSaved={onClose} onOccurrenceCreated={onClose} />}
        </div>
    );
};
