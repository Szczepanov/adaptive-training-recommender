import type { Screen } from './navigation';

const ROUTED_SCREENS: ReadonlySet<string> = new Set<Screen>([
  'home', 'checkin', 'goals', 'constraints', 'preferences',
  'data', 'plan', 'brief', 'sessions', 'testing',
]);

type RouteLocation = Pick<Location, 'pathname' | 'search' | 'hash'>;

/** Top-level athlete screens use a private query route; transient UI has no route. */
export function readScreenRoute(location: Pick<RouteLocation, 'pathname' | 'search'>): Screen | null {
  if (location.pathname !== '/') return null;
  const values = new URLSearchParams(location.search).getAll('screen');
  return values.length === 1 && ROUTED_SCREENS.has(values[0]) ? values[0] as Screen : null;
}

/** Keep unrelated callback parameters until their owning feature consumes them. */
export function screenRouteUrl(location: RouteLocation, screen: Screen): string {
  const params = new URLSearchParams(location.search);
  params.set('screen', screen);
  return `/?${params.toString()}${location.hash}`;
}

/** Fail closed when the cached decision belongs to yesterday or is incomplete. */
export function requiresCurrentCheckin(
  decisionDate: string | null,
  checkinComplete: boolean,
  today: string,
): boolean {
  return decisionDate !== today || !checkinComplete;
}
