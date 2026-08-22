import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { HealthContextSection } from './HealthContextSection';

describe('HealthContextSection', () => {
    it('defaults contextual health flags to No and does not ask manual physiology questions', () => {
        const html = renderToStaticMarkup(
            <HealthContextSection
                value={undefined}
                symptomsPresent={false}
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
        for (const label of ['Heat / sauna', 'Dehydration / fluid loss', 'Vaccination', 'Medication change', 'Close sick contact']) {
            const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            expect(html).toMatch(new RegExp(`aria-label="${escaped}"[\\s\\S]*?<button[^>]*aria-pressed="true"[^>]*>No<\\/button>`));
        }
        expect(html).not.toContain('Unknown');
        expect(html).not.toContain('Manual physiology fallback');
        expect(html).not.toContain('RHR higher than usual?');
        expect(html).not.toContain('HRV lower than usual?');
        expect(html).not.toContain('Respiration higher than usual?');
        expect(html).not.toContain('health-context__symptoms');
    });

    it('treats legacy null contextual values as the new No default', () => {
        const html = renderToStaticMarkup(
            <HealthContextSection
                value={{
                    unusualHeatOrSauna: null,
                    dehydrationOrFluidLoss: null,
                    recentVaccination: null,
                    medicationChange: null,
                    closeSickContact: null,
                }}
                symptomsPresent={false}
                onChange={() => {}}
            />,
        );

        expect(html).not.toContain('Unknown');
        expect(html).toMatch(/aria-label="Close sick contact"[\s\S]*?<button[^>]*aria-pressed="true"[^>]*>No<\/button>/);
    });

    it('shows a Yes selection and context badge when a contextual flag is reported', () => {
        const html = renderToStaticMarkup(
            <HealthContextSection value={{ closeSickContact: true }} symptomsPresent={false} onChange={() => {}} />,
        );

        expect(html).toMatch(/aria-label="Close sick contact"[\s\S]*?<button[^>]*aria-pressed="true"[^>]*>Yes<\/button>/);
        expect(html).toContain('Context added');
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
