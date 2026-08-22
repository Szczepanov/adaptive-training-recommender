import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { HealthContextSection } from './HealthContextSection';

describe('HealthContextSection', () => {
    it('renders a compact optional prompt without duplicating training, sleep, or stress questions', () => {
        const html = renderToStaticMarkup(
            <HealthContextSection value={undefined} symptomsPresent={false} onChange={() => {}} />,
        );

        expect(html).toContain('Anything unusual since yesterday?');
        expect(html).toContain('Alcohol');
        expect(html).toContain('Travel / jet lag');
        expect(html).toContain('Heat / sauna');
        expect(html).toContain('Dehydration / fluid loss');
        expect(html).toContain('Close sick contact');
        expect(html).not.toContain('Hard training');
        expect(html).not.toContain('Poor sleep');
        expect(html).not.toContain('High stress');
        expect(html).not.toContain('health-context__symptoms');
    });

    it('renders close sick contact as explicit yes/no choices while preserving unanswered state', () => {
        const unanswered = renderToStaticMarkup(
            <HealthContextSection value={{}} symptomsPresent={false} onChange={() => {}} />,
        );
        const answeredNo = renderToStaticMarkup(
            <HealthContextSection value={{ closeSickContact: false }} symptomsPresent={false} onChange={() => {}} />,
        );
        const answeredYes = renderToStaticMarkup(
            <HealthContextSection value={{ closeSickContact: true }} symptomsPresent={false} onChange={() => {}} />,
        );

        expect(unanswered).toContain('aria-label="Close sick contact"');
        expect(unanswered).toMatch(/<button[^>]*aria-pressed="false"[^>]*>No<\/button>/);
        expect(unanswered).toMatch(/<button[^>]*aria-pressed="false"[^>]*>Yes<\/button>/);
        expect(answeredNo).toMatch(/<button[^>]*aria-pressed="true"[^>]*>No<\/button>/);
        expect(answeredYes).toMatch(/<button[^>]*aria-pressed="true"[^>]*>Yes<\/button>/);
    });

    it('shows selected context and a time-zone input when a shift is reported', () => {
        const html = renderToStaticMarkup(
            <HealthContextSection
                value={{ alcoholDrinksLast24h: 2, travelDisruption: 'timezone_shift', timezoneShiftHours: 2 }}
                symptomsPresent={false}
                onChange={() => {}}
            />,
        );

        expect(html).toContain('Context added');
        expect(html).toContain('Time-zone change (hours)');
        expect(html).toContain('value="2"');
        expect(html).toContain('aria-pressed="true"');
    });

    it('reveals optional onset, severity, and type controls for reported symptoms', () => {
        const html = renderToStaticMarkup(
            <HealthContextSection
                value={{
                    symptoms: {
                        present: true,
                        onset: 'yesterday',
                        severity: 'mild',
                        types: ['sore_throat'],
                    },
                }}
                symptomsPresent={true}
                onChange={() => {}}
            />,
        );

        expect(html).toContain('Symptom details');
        expect(html).toContain('Yesterday');
        expect(html).toContain('Mild');
        expect(html).toContain('Sore throat');
        expect(html).toContain('Context added');
    });
});
