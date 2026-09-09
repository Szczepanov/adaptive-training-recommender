import type { Screen } from '../types/navigation';

export interface PrimaryNavigationDestination {
  screen: Screen;
  icon: string;
}

/**
 * The daily-loop destinations promoted at the top level on every shell (#482).
 * Both Header and MobileNav render from this list so the primary set and order
 * cannot drift between desktop and mobile.
 */
export const PRIMARY_NAV_ITEMS: readonly PrimaryNavigationDestination[] = [
  { screen: 'home', icon: '🏠' },
  { screen: 'checkin', icon: '✓' },
  { screen: 'plan', icon: '📋' },
];

export function isPrimaryNavigationScreen(screen: Screen): boolean {
  return PRIMARY_NAV_ITEMS.some((destination) => destination.screen === screen);
}

export interface DrawerDestination {
  screen: Screen;
  icon: string;
  description: string;
  refreshDecisionInput?: boolean;
}

export interface DrawerGroup {
  id: string;
  title: string;
  description: string;
  items: readonly DrawerDestination[];
}

/**
 * Intent-grouped overflow destinations (#486), shared by the mobile
 * `MobileNav` drawer and the desktop `Header` More disclosure (#482) so both
 * shells demote the same destinations under the same group titles.
 * Destination labels still render from `navigation.ts` `SCREEN_LABELS`;
 * this model owns overflow grouping and order.
 */
export const DRAWER_GROUPS: readonly DrawerGroup[] = [
  {
    id: 'train',
    title: 'Train',
    description: 'Sessions, assessments, and the week-ahead plan',
    items: [
      {
        screen: 'sessions',
        icon: '🚀',
        description: 'Run a multidomain fixture and record native measures',
      },
      {
        screen: 'testing',
        icon: '🧪',
        description: 'Run a locked assessment and record comparable raw outcomes',
      },
      {
        screen: 'plan',
        icon: '📋',
        description: 'Compare the coach plan against the adaptive forecast',
      },
    ],
  },
  {
    id: 'configure',
    title: 'Configure',
    description: 'Goals, setup, and coaching preferences',
    items: [
      {
        screen: 'goals',
        icon: '🎯',
        description: 'Manage events and target milestones',
      },
      {
        screen: 'constraints',
        icon: '⚠️',
        description: 'Manage physical cautions & equipment',
      },
      {
        screen: 'preferences',
        icon: '⚙️',
        description: 'Configure modalities & strain caps',
      },
    ],
  },
  {
    id: 'understand',
    title: 'Understand',
    description: 'Data review and AI context export',
    items: [
      {
        screen: 'data',
        icon: '📊',
        description: 'View analytics and snapshot telemetry',
        refreshDecisionInput: true,
      },
      {
        screen: 'brief',
        icon: '📤',
        description: 'Compile recent metrics & prompt for your AI',
        refreshDecisionInput: true,
      },
    ],
  },
];
