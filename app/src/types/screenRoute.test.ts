import { describe, expect, it } from 'vitest';
import { readScreenRoute, requiresCurrentCheckin, screenRouteUrl } from './screenRoute';

describe('private screen routes', () => {
  it('round-trips every top-level screen', () => {
    const screens = ['home', 'checkin', 'goals', 'constraints', 'preferences', 'data', 'plan', 'brief', 'sessions', 'testing'] as const;
    for (const screen of screens) {
      expect(readScreenRoute({ pathname: '/', search: `?screen=${screen}` })).toBe(screen);
    }
  });

  it('rejects unknown paths, unknown screens, missing screens and ambiguous duplicates', () => {
    expect(readScreenRoute({ pathname: '/', search: '' })).toBeNull();
    expect(readScreenRoute({ pathname: '/', search: '?screen=admin' })).toBeNull();
    expect(readScreenRoute({ pathname: '/private', search: '?screen=goals' })).toBeNull();
    expect(readScreenRoute({ pathname: '/', search: '?screen=goals&screen=home' })).toBeNull();
  });

  it('routes the Google Health callback path to Preferences', () => {
    expect(readScreenRoute({ pathname: '/settings', search: '?googleHealthLinked=success' })).toBe('preferences');
  });

  it('changes only the screen query while retaining callback parameters and the hash', () => {
    const url = screenRouteUrl({ pathname: '/', search: '?googleHealthLinked=success&screen=home', hash: '#status' }, 'preferences');
    expect(url).toBe('/?googleHealthLinked=success&screen=preferences#status');
  });

  it('requires a new check-in when the cached decision belongs to a previous local day', () => {
    expect(requiresCurrentCheckin('2026-09-22', true, '2026-09-23')).toBe(true);
    expect(requiresCurrentCheckin('2026-09-23', false, '2026-09-23')).toBe(true);
    expect(requiresCurrentCheckin('2026-09-23', true, '2026-09-23')).toBe(false);
  });
});
