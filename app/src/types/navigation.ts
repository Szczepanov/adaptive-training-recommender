export type Screen = 'home' | 'checkin' | 'goals' | 'constraints' | 'preferences' | 'data' | 'plan' | 'brief' | 'sessions' | 'testing';

/**
 * Canonical user-facing label per Screen value (#485).
 * Header, MobileNav, and each screen's heading all render from this map
 * so the same Screen is never labeled differently across surfaces.
 */
export const SCREEN_LABELS: Record<Screen, string> = {
  home: 'Home',
  checkin: 'Check-in',
  goals: 'Goals',
  constraints: 'Training Setup',
  preferences: 'Coach Preferences',
  data: 'Data',
  plan: 'Plan',
  brief: 'Export Context for AI',
  sessions: 'Sessions',
  testing: 'Testing',
};
