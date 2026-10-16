import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ActivityDetailsEditor } from './ActivityDetailsEditor';

vi.mock('../services/activityAnnotationService', () => ({
  activityAnnotationService: { getActivityAnnotation: vi.fn() },
}));

describe('ActivityDetailsEditor', () => {
  it('keeps provider identity visible while annotations load, for any activity type', () => {
    for (const type of ['elliptical', 'running', 'strength_training']) {
      const html = renderToStaticMarkup(<ActivityDetailsEditor userId="athlete" activityId="workout" providerType={type} />);
      expect(html).toContain(type.replaceAll('_', ' '));
      expect(html).toContain('Loading activity details');
      expect(html).not.toContain('7/10');
      expect(html).not.toContain('type="number"');
    }
  });
});
