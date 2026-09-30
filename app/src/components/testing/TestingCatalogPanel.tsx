import React from 'react';
import {
    PERFORMANCE_TEST_DEFINITIONS,
    getPerformanceTestFamily,
} from '../../observations/performanceTestingCatalog';

const FAMILIES: readonly { id: 'cycling' | 'strength' | 'field'; label: string }[] = [
    { id: 'cycling', label: 'Cycling' },
    { id: 'strength', label: 'Strength' },
    { id: 'field', label: 'Field & power' },
];

export interface TestingCatalogPanelProps {
    busy: boolean;
    protocolId: string;
    onProtocolIdChange: (value: string) => void;
    protocolRevision: string;
    onProtocolRevisionChange: (value: string) => void;
    onSelectBundledTest: (definitionId: string) => void;
    onLoadProtocol: () => void;
    onExportJson: () => void;
}

export const TestingCatalogPanel: React.FC<TestingCatalogPanelProps> = ({
    busy,
    protocolId,
    onProtocolIdChange,
    protocolRevision,
    onProtocolRevisionChange,
    onSelectBundledTest,
    onLoadProtocol,
    onExportJson,
}) => {
    return (
        <>
            <section className="testing-card">
                <div className="testing-card-header-row">
                    <h3>Bundled assessments</h3>
                    <button
                        type="button"
                        className="testing-secondary export-diagnostic-btn"
                        disabled={busy}
                        onClick={onExportJson}
                    >
                        Export physical-capital evidence (JSON)
                    </button>
                </div>
                <p>Choose a versioned default protocol. Its immutable revision is created on first use and never silently changed later.</p>
                <div className="bundled-catalog-groups">
                    {FAMILIES.map(family => {
                        const tests = PERFORMANCE_TEST_DEFINITIONS.filter(def => getPerformanceTestFamily(def) === family.id);
                        if (tests.length === 0) return null;
                        return (
                            <div key={family.id} className="catalog-group">
                                <h4 className="catalog-group-heading">{family.label}</h4>
                                <div className="testing-grid two">
                                    {tests.map(definition => (
                                        <button
                                            key={definition.id}
                                            type="button"
                                            className="testing-secondary"
                                            disabled={busy}
                                            onClick={() => onSelectBundledTest(definition.id)}
                                        >
                                            {definition.protocol.title} · rev {definition.protocol.revision}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        );
                    })}
                </div>
            </section>
            <section className="testing-card">
                <h3>Load another immutable protocol revision</h3>
                <p>Advanced path: enter the exact user-owned protocol ID and revision. Testing never silently upgrades to a newer revision.</p>
                <div className="testing-grid two">
                    <label>
                        Protocol ID
                        <input value={protocolId} onChange={event => onProtocolIdChange(event.target.value)} />
                    </label>
                    <label>
                        Revision
                        <input inputMode="numeric" value={protocolRevision} onChange={event => onProtocolRevisionChange(event.target.value)} />
                    </label>
                </div>
                <button
                    type="button"
                    className="testing-primary"
                    disabled={busy || !protocolId.trim()}
                    onClick={onLoadProtocol}
                >
                    {busy ? 'Loading…' : 'Load protocol'}
                </button>
            </section>
        </>
    );
};
