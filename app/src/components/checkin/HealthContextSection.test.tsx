import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { HealthContextSection } from './HealthContextSection';

describe('HealthContextSection', () => {
    it('renders the requested default health context without duplicating training, sleep, or stress questions', () => {
        const html = renderToStaticMarkup(
            <HealthContextSection value={undefined} symptomsPresent={false} onChange={() => {}} />,
        );

        expect(html).toContain('Anything unusual since yesterday?');
        expect(html).toContain('Alcohol');
        expect(html).toContain('Travel / jet lag');
        expect(html).toContain('Heat / sauna');
        expect(html).toContain('Dehydration / fluid loss');
        expect(html).toContain('Vaccination');
        expect(html).toContain('Medication change');
        expect(html).toContain('Close sick contact');
        expect(html).toContain('RHR higher than usual?');
        expect(html).toContain('HRV lower than usual?');
        expect(html).toContain('Respiration higher than usual?');
        expect(html).toMatch(/<button[^>]*aria-pressed="true"[^>]*>None<\/button>/);
        expect(html).toMatch(/aria-label="Travel disruption"[\s\S]*?<button[^>]*aria-pressed="true"[^>]*>No<\/button>/);
        expect(html).not.toContain('Hard training');
        expect(html).not.toContain('Poor sleep');
        expect(html).not.toContain('High stress');
        expect(html).not.toContain('health-context__symptoms');
    });

    it('renders contextual booleans as explicit unknown/no/yes tri-state choices', () => {
        const unanswered = renderToStaticMarkup(
            <HealthContextSection value={{}} symptomsPresent={false} onChange={() => {}} />,
        );
        const answeredNo = renderToStaticMarkup(
            <HealthContextSection value={{ closeSickContact: false }} symptomsPresent={false} onChange={() => {}} />,
        );
        const answeredYes = renderToStaticMarkup(
            <HealthContextSection value={{ closeSickContact: true }} symptomsPresent={false} onChange={() => {}} />,
        );

        expect(unanswered).toMatch(/aria-label="Close sick contact"[\s\S]*?<button[^>]*aria-pressed="true"[^>]*>Unknown<\/button>/);
        expect(answeredNo).toMatch(/aria-label="Close sick contact"[\s\S]*?<button[^>]*aria-pressed="true"[^>]*>No<\/button>/);
        expect(answeredYes).toMatch(/aria-label="Close sick contact"[\s\S]*?<button[^>]*aria-pressed="true"[^>]*>Yes<\/button>/);
    });

    it('keeps manual RHR, HRV, and respiration changes unknown until explicitly answered', () => {
        const unanswered = renderToStaticMarkup(
            <HealthContextSection value={{}} symptomsPresent={false} onChange={() => {}} />,
        );
        const changed = renderToStaticMarkup(
            <HealthContextSection
                value={{ subjectiveRhrHigher: true, subjectiveHrvLower: true, subjectiveRespirationHigher: false }}
                symptomsPresent={false}
                onChange={() => {}}
            />,
        );

        expect(unanswered).toMatch(/aria-label="RHR higher than usual\?"[\s\S]*?<button[^>]*aria-pressed="true"[^>]*>Unknown<\/button>/);
        expect(unanswered).toMatch(/aria-label="HRV lower than usual\?"[\s\S]*?<button[^>]*aria-pressed="true"[^>]*>Unknown<\/button>/);
        expect(unanswered).toMatch(/aria-label="Respiration higher than usual\?"[\s\S]*?<button[^>]*aria-pressed="true"[^>]*>Unknown<\/button>/);
        expect(changed).toContain('Context added');
        expect(changed).toMatch(/aria-label="RHR higher than usual\?"[\s\S]*?<button[^>]*aria-pressed="true"[^>]*>Yes<\/button>/);
        expect(changed).toMatch(/aria-label="HRV lower than usual\?"[\s\S]*?<button[^>]*aria-pressed="true"[^>]*>Yes<\/button>/);
        expect(changed).toMatch(/aria-label="Respiration higher than usual\?"[\s\S]*?<button[^>]*aria-pressed="true"[^>]*>No<\/button>/);
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
