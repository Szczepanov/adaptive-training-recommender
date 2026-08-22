import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { HealthContextSection } from './HealthContextSection';

describe('HealthContextSection', () => {
    it('renders requested health defaults without duplicating wearable questions when Garmin is present', () => {
        const html = renderToStaticMarkup(
            <HealthContextSection
                value={undefined}
                symptomsPresent={false}
                manualPhysiologyMissing={{ rhr: false, hrv: false, respiration: false }}
                onChange={() => {}}
            />,
        );

        expect(html).toContain('Anything unusual since yesterday?');
        expect(html).toContain('Alcohol');
        expect(html).toContain('Travel / jet lag');
        expect(html).toContain('Heat / sauna');
        expect(html).toContain('Dehydration / fluid loss');
        expect(html).toContain('Vaccination');
        expect(html).toContain('Medication change');
        expect(html).toContain('Close sick contact');
        expect(html).toMatch(/<button[^>]*aria-pressed="true"[^>]*>None<\/button>/);
        expect(html).toMatch(/aria-label="Travel disruption"[\s\S]*?<button[^>]*aria-pressed="true"[^>]*>No<\/button>/);
        expect(html).not.toContain('RHR higher than usual?');
        expect(html).not.toContain('HRV lower than usual?');
        expect(html).not.toContain('Respiration higher than usual?');
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

    it('only asks manual RHR, HRV, and respiration comparisons for missing objective signals', () => {
        const html = renderToStaticMarkup(
            <HealthContextSection
                value={{ manualRhrHigher: true, manualRespirationHigher: false }}
                symptomsPresent={false}
                manualPhysiologyMissing={{ rhr: true, hrv: false, respiration: true }}
                onChange={() => {}}
            />,
        );

        expect(html).toContain('Manual physiology fallback');
        expect(html).toContain('RHR higher than usual?');
        expect(html).not.toContain('HRV lower than usual?');
        expect(html).toContain('Respiration higher than usual?');
        expect(html).toMatch(/aria-label="RHR higher than usual\?"[\s\S]*?<button[^>]*aria-pressed="true"[^>]*>Yes<\/button>/);
        expect(html).toMatch(/aria-label="Respiration higher than usual\?"[\s\S]*?<button[^>]*aria-pressed="true"[^>]*>No<\/button>/);
        expect(html).toContain('Context added');
    });

    it('keeps missing manual physiology unknown until explicitly answered', () => {
        const html = renderToStaticMarkup(
            <HealthContextSection
                value={{}}
                symptomsPresent={false}
                manualPhysiologyMissing={{ rhr: true, hrv: true, respiration: true }}
                onChange={() => {}}
            />,
        );

        expect(html).toMatch(/aria-label="RHR higher than usual\?"[\s\S]*?<button[^>]*aria-pressed="true"[^>]*>Unknown<\/button>/);
        expect(html).toMatch(/aria-label="HRV lower than usual\?"[\s\S]*?<button[^>]*aria-pressed="true"[^>]*>Unknown<\/button>/);
        expect(html).toMatch(/aria-label="Respiration higher than usual\?"[\s\S]*?<button[^>]*aria-pressed="true"[^>]*>Unknown<\/button>/);
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
