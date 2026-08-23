import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { UserPreferences } from '../../engine/models';
import { PerformanceSections } from './PerformanceSections';

function buildPreferences(distance: 'km' | 'miles'): UserPreferences {
  return {
    userId: 'test-user',
    preferredRecoveryStyle: 'mixed',
    defaultWeekdayTimeMin: 45,
    defaultWeekendTimeMin: 60,
    preferredTimeOfDay: 'flexible',
    preferredModalities: ['Running'],
    deprioritizedModalities: [],
    avoidedModalities: [],
    unavailableModalities: [],
    explanationVerbosity: 'detailed',
    conservativeBias: false,
    preferredUnits: {
      distance,
      weight: 'kg',
      temperature: 'celsius',
    },
    performanceProfile: {
      racePredictions: {
        fiveKmSec: 1273,
        tenKmSec: 2721,
        halfMarathonSec: 6167,
        marathonSec: 12840,
      },
    },
    schemaVersion: 1,
    createdAt: '2026-08-23T00:00:00.000Z',
    updatedAt: '2026-08-23T00:00:00.000Z',
  } as UserPreferences;
}

function render(distance: 'km' | 'miles'): string {
  return renderToStaticMarkup(
    <PerformanceSections
      preferences={buildPreferences(distance)}
      updateCapability={() => undefined}
      updatePerformanceTarget={() => undefined}
      updateEstimated1Rm={() => undefined}
    />,
  );
}

describe('PerformanceSections Garmin race predictions', () => {
  it('renders Garmin finish times and metric pace benchmarks', () => {
    const html = render('km');

    expect(html).toContain('Garmin Race Predictions');
    expect(html).toContain('21:13');
    expect(html).toContain('45:21');
    expect(html).toContain('1:42:47');
    expect(html).toContain('3:34:00');
    expect(html).toContain('Pace 4:15/km');
  });

  it('derives pace per mile when imperial distance units are selected', () => {
    const html = render('miles');

    expect(html).toContain('21:13');
    expect(html).toContain('Pace 6:50/mi');
  });
});
