import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ActivityLaps } from './ActivityLaps';

vi.mock('../services/activityAnnotationService', () => ({
  activityAnnotationService: { getLapAnnotations: vi.fn(), saveLapAnnotation: vi.fn() },
}));

describe('ActivityLaps', () => {
  const activity = { activityId: 'airbike-1', laps: [
    { lapIndex: 1, durationSeconds: 600, averageHrBpm: 150, maxHrBpm: 177 },
    { lapIndex: 2, durationSeconds: 120, averagePowerWatts: 100, averageHrBpm: 125 },
  ] };

  it('preserves provider lap duration, power and heart rate in the read-only view', () => {
    const html = renderToStaticMarkup(<ActivityLaps activity={activity} />);
    expect(html).toContain('Lap summaries');
    expect(html).toContain('150 bpm');
    expect(html).toContain('<th scope="col">Avg HR</th><th scope="col">Max HR</th>');
    expect(html).toContain('<td data-label="Max HR">177 bpm</td>');
    expect(html).toContain('<td data-label="Max HR">—</td>');
    expect(html).toContain('100 W');
    expect(html).not.toContain('Edit lap');
  });

  it('explains loading manual power without exposing edits before the read completes', () => {
    const html = renderToStaticMarkup(<ActivityLaps activity={activity} userId="athlete-1" />);
    expect(html).toContain('Loading manual lap details');
    expect(html).not.toContain('Edit lap');
  });

  it('renders nothing for an activity without laps', () => {
    expect(renderToStaticMarkup(<ActivityLaps activity={{ activityId: 'no-laps' }} />)).toBe('');
  });
});
