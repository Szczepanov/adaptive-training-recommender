import React, { useState } from 'react';
import type { SessionDefinition } from '../../sessions/models';
import { validateSessionDefinition } from '../../sessions/validation';
import { isCanonicalWorkoutExport, adaptCanonicalWorkoutToSessionDefinition } from '../../sessions/canonicalWorkoutAdapter';
import { SessionDefinitionPreview } from './SessionDefinitionPreview';
import { type PreparedSessionLaunch, SessionDestinationSheet } from './SessionDestinationSheet';
import './ManualSessionBuilder.css';

interface SessionJsonImportProps {
    userId: string;
    onClose: () => void;
    onStartExecution: (session: PreparedSessionLaunch) => void;
}

/** Imports normalized SessionDefinition (schemaVersion: 1) or Canonical Workout Export (canonical_workout_v1) format. */
export const SessionJsonImport: React.FC<SessionJsonImportProps> = ({ userId, onClose, onStartExecution }) => {
    const [json, setJson] = useState('');
    const [definition, setDefinition] = useState<SessionDefinition | null>(null);
    const [importedSourceFormat, setImportedSourceFormat] = useState<'canonical_workout_v1' | 'session_definition' | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [showDestination, setShowDestination] = useState(false);

    const review = () => {
        try {
            const raw: unknown = JSON.parse(json);
            let targetToValidate: unknown = raw;
            let sourceFormat: 'canonical_workout_v1' | 'session_definition' = 'session_definition';

            if (isCanonicalWorkoutExport(raw)) {
                targetToValidate = adaptCanonicalWorkoutToSessionDefinition(raw);
                sourceFormat = 'canonical_workout_v1';
            }

            const result = validateSessionDefinition(targetToValidate);
            if (!result.ok) {
                setDefinition(null);
                setImportedSourceFormat(null);
                setError(result.issues.map(issue => `${issue.path}: ${issue.message}`).join('\n'));
                return;
            }
            setError(null);
            setImportedSourceFormat(sourceFormat);
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
                    <label htmlFor="session-json">Session definition or Workout Export JSON</label>
                    <textarea id="session-json" value={json} onChange={event => setJson(event.target.value)} rows={18} spellCheck={false} placeholder={'{\n  "schemaVersion": 1,\n  "id": "my-session",\n  "revision": 1,\n  "title": "…",\n  "intent": "training",\n  "blocks": […]\n}\n\n// Or paste workout export JSON (canonical_workout_v1)'} />
                </div>
                <p className="builder-help">The importer accepts Session Definitions (<code>schemaVersion: 1</code>) as well as Workout Exports (<code>canonical_workout_v1</code>). Unknown or custom movements should use <code>unresolved_free_text</code>; they remain loggable but do not claim catalog safety or training-effect metadata.</p>
                {importedSourceFormat === 'canonical_workout_v1' && (
                    <p className="builder-help" style={{ color: 'var(--color-primary-dark, #2b6cb0)' }}>
                        ✓ Converted from Workout Export format (<code>canonical_workout_v1</code>) into a normalized Session Definition.
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
