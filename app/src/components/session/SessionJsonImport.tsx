import React, { useState } from 'react';
import type { SessionDefinition } from '../../sessions/models';
import { validateSessionDefinition } from '../../sessions/validation';
import { SessionDefinitionPreview } from './SessionDefinitionPreview';
import { type PreparedSessionLaunch, SessionDestinationSheet } from './SessionDestinationSheet';
import './ManualSessionBuilder.css';

interface SessionJsonImportProps {
    userId: string;
    onClose: () => void;
    onStartExecution: (session: PreparedSessionLaunch) => void;
}

/** Imports the normalized SessionDefinition format; it deliberately does not infer structure from prose. */
export const SessionJsonImport: React.FC<SessionJsonImportProps> = ({ userId, onClose, onStartExecution }) => {
    const [json, setJson] = useState('');
    const [definition, setDefinition] = useState<SessionDefinition | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [showDestination, setShowDestination] = useState(false);

    const review = () => {
        try {
            const raw: unknown = JSON.parse(json);
            const result = validateSessionDefinition(raw);
            if (!result.ok) {
                setDefinition(null);
                setError(result.issues.map(issue => `${issue.path}: ${issue.message}`).join('\n'));
                return;
            }
            setError(null);
            setDefinition(result.value);
        } catch (err: unknown) {
            setDefinition(null);
            setError(err instanceof Error ? `Invalid JSON: ${err.message}` : 'Invalid JSON');
        }
    };

    return (
        <div className="manual-session-builder">
            <header className="builder-header">
                <div><h2>Import session JSON</h2><p>Paste a normalized session definition, then review every block before saving or starting it.</p></div>
                <button type="button" className="close-builder-btn" onClick={onClose} aria-label="Close import">×</button>
            </header>
            <div className="builder-form">
                <div className="form-group">
                    <label htmlFor="session-json">Session definition JSON</label>
                    <textarea id="session-json" value={json} onChange={event => setJson(event.target.value)} rows={18} spellCheck={false} placeholder={'{\n  "schemaVersion": 1,\n  "id": "my-session",\n  "revision": 1,\n  "title": "…",\n  "intent": "training",\n  "blocks": […]\n}'} />
                </div>
                <p className="builder-help">The importer accepts explicit structure only. Unknown or custom movements should use <code>unresolved_free_text</code>; they remain loggable but do not claim catalog safety or training-effect metadata.</p>
                {error && <pre className="destination-error-box" role="alert">{error}</pre>}
                <div className="builder-actions"><button type="button" className="save-and-proceed-btn" onClick={review}>Validate & preview</button></div>
            </div>
            {definition && <SessionDefinitionPreview definition={definition} onChooseDestination={() => setShowDestination(true)} />}
            {definition && <SessionDestinationSheet userId={userId} definition={definition} isOpen={showDestination} onClose={() => setShowDestination(false)} onStartExecution={onStartExecution} onSaved={onClose} />}
        </div>
    );
};
