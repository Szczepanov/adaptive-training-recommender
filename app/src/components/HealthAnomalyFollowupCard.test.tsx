import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { HealthAnomalyFollowupForm } from './HealthAnomalyFollowupCard';

const candidate = {
    episodeId: 'health-anomaly:2026-08-20',
    sourceAssessment: { date: '2026-08-20', revisionId: 'ha-1234567890abcdef' },
    episodeDay: 2,
};

describe('HealthAnomalyFollowupForm', () => {
    it('renders every HA6 explanation choice without turning the form into an alert', () => {
        const html = renderToStaticMarkup(
            <HealthAnomalyFollowupForm candidate={candidate} existing={null} onSave={vi.fn()} />,
        );
        expect(html).toContain('Recovery follow-up (shadow)');
        expect(html).toContain('I developed illness symptoms');
        expect(html).toContain('Hard training / recovery');
        expect(html).toContain('Nothing obvious');
        expect(html).toContain('Other / not sure');
        expect(html).toContain('does not change your recommendation');
        expect(html).not.toContain('Possible illness or other systemic stress');
    });

    it('renders an existing symptom/test label for later editing', () => {
        const html = renderToStaticMarkup(
            <HealthAnomalyFollowupForm
                candidate={candidate}
                existing={{
                    userId: 'u1', episodeId: candidate.episodeId, sourceAssessment: candidate.sourceAssessment,
                    explanation: 'illness_symptoms',
                    symptomOnset: { date: '2026-08-21', precision: 'day' },
                    respiratoryTest: { result: 'positive', testedOn: '2026-08-21', source: 'user_reported' },
                    note: 'Later symptoms', createdAt: '2026-08-21T06:00:00Z', updatedAt: '2026-08-21T18:00:00Z', schemaVersion: 1,
                }}
                onSave={vi.fn()}
            />,
        );
        expect(html).toContain('Approximate symptom onset date');
        expect(html).toContain('value="2026-08-21"');
        expect(html).toContain('Update follow-up');
        expect(html).toContain('Later symptoms');
    });
});
