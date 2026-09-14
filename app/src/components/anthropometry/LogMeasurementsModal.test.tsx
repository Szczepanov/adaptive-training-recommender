import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { LogMeasurementsModal } from './LogMeasurementsModal';
import type { AnthropometryEntry } from '../../anthropometry/models';

describe('LogMeasurementsModal component (ADR-0039 BC1)', () => {
  it('renders nothing when closed', () => {
    const html = renderToStaticMarkup(
      <LogMeasurementsModal
        userId="u1"
        isOpen={false}
        onClose={() => {}}
        onSaved={() => {}}
      />
    );
    expect(html).toBe('');
  });

  it('defaults the core weekly set (waist, abdomen, hips) enabled and secondary/optional metrics disabled for a fresh session', () => {
    const html = renderToStaticMarkup(
      <LogMeasurementsModal
        userId="u1"
        isOpen={true}
        onClose={() => {}}
        onSaved={() => {}}
      />
    );

    expect(html).toContain('Log Measurements');
    expect(html).toContain('Core Weekly Set (Waist, Abdomen, Hips)');
    expect(html).toContain('Waist minimum');
    expect(html).toContain('Abdomen at navel');
    expect(html).toContain('Hips (maximum)');
    // Optional group is collapsed by default -- no reading inputs rendered for it yet.
    expect(html).toContain('Show other circumferences');
    expect(html).not.toContain('Chest (nipple line)');
  });

  it('shows the connected-scale banner and hides manual weight by default when a provider weight exists', () => {
    const html = renderToStaticMarkup(
      <LogMeasurementsModal
        userId="u1"
        isOpen={true}
        onClose={() => {}}
        onSaved={() => {}}
        todayProviderWeightKg={74.2}
      />
    );

    expect(html).toContain('Connected Scale Synced');
    expect(html).toContain('74.2 kg');
    expect(html).toContain('Add manual weight');
    // Manual weight input is not shown until the athlete explicitly asks for the fallback.
    expect(html).not.toContain('Manual Body Mass (kg)');
  });

  it('shows the manual weight fallback by default when no provider weight is available', () => {
    const html = renderToStaticMarkup(
      <LogMeasurementsModal
        userId="u1"
        isOpen={true}
        onClose={() => {}}
        onSaved={() => {}}
        todayProviderWeightKg={null}
      />
    );

    expect(html).not.toContain('Connected Scale Synced');
    expect(html).toContain('Manual Body Mass (kg)');
    // No provider weight to fall back from, so there is nothing to hide back to.
    expect(html).not.toContain('Hide manual weight');
  });

  it('offers left/right/unspecified laterality controls only for limb metrics once enabled', () => {
    const entryToEdit: AnthropometryEntry = {
      id: 'entry-1',
      userId: 'u1',
      date: '2026-09-10',
      observedAt: '2026-09-10T06:00:00.000Z',
      protocol: 'home_anthropometry@1',
      context: { morningPostVoidPreIntake: true, trainingBeforeMeasurement: false },
      measurements: [
        { metricId: 'thigh_mid_cm', laterality: 'left', unit: 'cm', readings: [55.0, 55.2], value: 55.1 },
      ],
      schemaVersion: 1,
      revision: 1,
      createdAt: '2026-09-10T06:00:00.000Z',
      updatedAt: '2026-09-10T06:00:00.000Z',
    };

    const html = renderToStaticMarkup(
      <LogMeasurementsModal
        userId="u1"
        isOpen={true}
        onClose={() => {}}
        onSaved={() => {}}
        entryToEdit={entryToEdit}
      />
    );

    // Laterality radios rendered for the enabled limb metric, pre-selected to the stored side.
    expect(html).toContain('name="laterality_thigh_mid_cm"');
    expect(html).toContain('Left');
    expect(html).toContain('Right');
    expect(html).toContain('Unspecified');
    // No laterality control for a non-limb core metric.
    expect(html).not.toContain('name="laterality_waist_minimum_cm"');
  });

  it('pre-fills date, readings and context from the entry being corrected, and labels the action as a correction', () => {
    const entryToEdit: AnthropometryEntry = {
      id: 'entry-2',
      userId: 'u1',
      date: '2026-09-05',
      observedAt: '2026-09-05T06:00:00.000Z',
      protocol: 'home_anthropometry@1',
      context: { morningPostVoidPreIntake: true, trainingBeforeMeasurement: true, respiratoryState: 'other' },
      measurements: [
        { metricId: 'waist_minimum_cm', unit: 'cm', readings: [81.0, 81.4], value: 81.2 },
        { metricId: 'body_mass_kg', unit: 'kg', readings: [70.5], value: 70.5 },
      ],
      schemaVersion: 1,
      revision: 2,
      createdAt: '2026-09-05T06:00:00.000Z',
      updatedAt: '2026-09-05T06:00:00.000Z',
    };

    const html = renderToStaticMarkup(
      <LogMeasurementsModal
        userId="u1"
        isOpen={true}
        onClose={() => {}}
        onSaved={() => {}}
        entryToEdit={entryToEdit}
      />
    );

    expect(html).toContain('Edit Anthropometry Entry');
    expect(html).toContain('Save Correction');
    expect(html).toContain('value="2026-09-05"');
    expect(html).toContain('value="81"'); // Reading 1
    expect(html).toContain('value="81.4"'); // Reading 2
    // Prior manual weight is prefilled into the fallback field, shown even without a provider weight.
    expect(html).toContain('Manual Body Mass (kg)');
    expect(html).toContain('value="70.5"');
  });

  it('shows the repeatability-quality prompt and 3rd reading when editing a session that already recorded one', () => {
    const entryToEdit: AnthropometryEntry = {
      id: 'entry-3',
      userId: 'u1',
      date: '2026-09-08',
      observedAt: '2026-09-08T06:00:00.000Z',
      protocol: 'home_anthropometry@1',
      context: { morningPostVoidPreIntake: true, trainingBeforeMeasurement: false },
      measurements: [
        // Pair [82.0, 83.5] differs by 1.5 cm > tolerance -> repeatability warning, 3rd reading taken.
        { metricId: 'waist_minimum_cm', unit: 'cm', readings: [82.0, 83.5, 82.6], value: 82.6, repeatabilityWarning: true },
      ],
      schemaVersion: 1,
      revision: 1,
      createdAt: '2026-09-08T06:00:00.000Z',
      updatedAt: '2026-09-08T06:00:00.000Z',
    };

    const html = renderToStaticMarkup(
      <LogMeasurementsModal
        userId="u1"
        isOpen={true}
        onClose={() => {}}
        onSaved={() => {}}
        entryToEdit={entryToEdit}
      />
    );

    expect(html).toContain('Reading 3 (Prompted)');
    expect(html).toContain('value="82.6"');
    expect(html).toContain('Take a 3rd reading; median will be saved.');
  });

  it('uses mobile-friendly decimal numeric input modes for every measurement field', () => {
    const html = renderToStaticMarkup(
      <LogMeasurementsModal
        userId="u1"
        isOpen={true}
        onClose={() => {}}
        onSaved={() => {}}
        todayProviderWeightKg={null}
      />
    );

    // Every numeric entry field (manual weight + core-set readings) declares inputMode="decimal".
    const decimalInputCount = (html.match(/inputMode="decimal"/g) || []).length;
    expect(decimalInputCount).toBeGreaterThanOrEqual(1 + 3 * 2); // manual weight + 3 core metrics x 2 readings
  });
});
