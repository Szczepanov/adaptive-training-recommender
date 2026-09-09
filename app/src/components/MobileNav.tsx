import React, { useEffect, useRef } from 'react';
import type { Screen } from '../types/navigation';
import { SCREEN_LABELS } from '../types/navigation';
import { getAuthInstance } from '../firebase';
import { buildInfo } from '../buildInfo';
import './MobileNav.css';

interface MobileNavProps {
  screen: Screen;
  handleNavigate: (screen: Screen) => void;
  loadDecisionInput: () => void;
  mobileMoreOpen: boolean;
  setMobileMoreOpen: React.Dispatch<React.SetStateAction<boolean>>;
}

interface DrawerDestination {
  screen: Screen;
  icon: string;
  description: string;
  refreshDecisionInput?: boolean;
}

interface DrawerGroup {
  id: string;
  title: string;
  description: string;
  items: readonly DrawerDestination[];
}

const MOBILE_MORE_SCREENS: readonly Screen[] = [
  'goals',
  'constraints',
  'preferences',
  'data',
  'brief',
  'sessions',
  'testing',
];

const DRAWER_GROUPS: readonly DrawerGroup[] = [
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

export const MobileNav: React.FC<MobileNavProps> = ({ screen, handleNavigate, loadDecisionInput, mobileMoreOpen, setMobileMoreOpen }) => {
  const mobileMoreBtnRef = useRef<HTMLButtonElement>(null);
  const mobileDrawerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (mobileMoreOpen) {
      document.body.style.overflow = 'hidden';
      const closeBtn = mobileDrawerRef.current?.querySelector<HTMLButtonElement>('.close-drawer-btn');
      closeBtn?.focus();
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [mobileMoreOpen]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (mobileMoreOpen) {
          setMobileMoreOpen(false);
          mobileMoreBtnRef.current?.focus();
        }
      }
      if (mobileMoreOpen && event.key === 'Tab' && mobileDrawerRef.current) {
        const focusables = Array.from(
          mobileDrawerRef.current.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')
        );
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [mobileMoreOpen, setMobileMoreOpen]);

  const handleLogout = async () => {
    const { signOut } = await import('firebase/auth');
    await signOut(getAuthInstance());
  };

  const buildTitle = `Git commit ${buildInfo.gitSha}${buildInfo.dirty ? ' (local working tree has uncommitted changes)' : ''}`;

  const navigateToDrawerDestination = (destination: DrawerDestination) => {
    if (destination.refreshDecisionInput) {
      loadDecisionInput();
    }
    handleNavigate(destination.screen);
  };

  return (
    <>
      <nav className="bottom-nav" aria-label="Primary">
        <button
          className={`nav-item ${screen === 'home' ? 'active' : ''}`}
          onClick={() => handleNavigate('home')}
          aria-current={screen === 'home' ? 'page' : undefined}
        >
          <span className="nav-icon">🏠</span>
          <span className="nav-label">{SCREEN_LABELS.home}</span>
        </button>

        <button
          className={`nav-item ${screen === 'checkin' ? 'active' : ''}`}
          onClick={() => handleNavigate('checkin')}
          aria-current={screen === 'checkin' ? 'page' : undefined}
        >
          <span className="nav-icon">✓</span>
          <span className="nav-label">{SCREEN_LABELS.checkin}</span>
        </button>

        <button
          className={`nav-item ${screen === 'plan' ? 'active' : ''}`}
          onClick={() => handleNavigate('plan')}
          aria-current={screen === 'plan' ? 'page' : undefined}
        >
          <span className="nav-icon">📋</span>
          <span className="nav-label">{SCREEN_LABELS.plan}</span>
        </button>

        <button
          ref={mobileMoreBtnRef}
          className={`nav-item ${MOBILE_MORE_SCREENS.includes(screen) ? 'active' : ''}`}
          onClick={() => setMobileMoreOpen((isOpen) => !isOpen)}
          aria-expanded={mobileMoreOpen}
          aria-haspopup="dialog"
        >
          <span className="nav-icon">⋯</span>
          <span className="nav-label">More</span>
        </button>
      </nav>

      {mobileMoreOpen && (
        <div className="mobile-more-overlay" onClick={() => setMobileMoreOpen(false)}>
          <div ref={mobileDrawerRef} className="mobile-more-drawer" role="dialog" aria-modal="true" aria-labelledby="mobile-more-title" onClick={(e) => e.stopPropagation()}>
            <div className="drawer-header">
              <h3 id="mobile-more-title">Navigation & Settings</h3>
              <button className="close-drawer-btn" onClick={() => setMobileMoreOpen(false)} aria-label="Close navigation and settings">✕</button>
            </div>
            <div className="drawer-items">
              {DRAWER_GROUPS.map((group) => {
                const titleId = `mobile-more-${group.id}-title`;
                const descriptionId = `mobile-more-${group.id}-description`;

                return (
                  <div
                    key={group.id}
                    className="drawer-group"
                    role="group"
                    aria-labelledby={titleId}
                    aria-describedby={descriptionId}
                  >
                    <div className="drawer-group-header">
                      <h4 id={titleId} className="drawer-group-title">{group.title}</h4>
                      <span id={descriptionId} className="drawer-group-description">{group.description}</span>
                    </div>
                    {group.items.map((destination) => {
                      const active = screen === destination.screen;
                      return (
                        <button
                          key={destination.screen}
                          className={`drawer-item ${active ? 'active' : ''}`}
                          onClick={() => navigateToDrawerDestination(destination)}
                          aria-current={active ? 'page' : undefined}
                        >
                          <span className="item-icon">{destination.icon}</span>
                          <div className="item-text">
                            <span className="item-title">{SCREEN_LABELS[destination.screen]}</span>
                            <span className="item-sub">{destination.description}</span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                );
              })}

              <div className="drawer-divider" />

              <div
                className="drawer-item"
                title={buildTitle}
                aria-label={`Build ${buildInfo.label}`}
                style={{ cursor: 'default', opacity: 0.72 }}
              >
                <span className="item-icon">ℹ️</span>
                <div className="item-text">
                  <span className="item-title">Build {buildInfo.label}</span>
                  <span className="item-sub">
                    {buildInfo.dirty ? 'Local working tree has uncommitted changes' : 'Exact Git commit for this app build'}
                  </span>
                </div>
              </div>

              <div className="drawer-divider" />

              <button className="drawer-item logout" onClick={handleLogout}>
                <span className="item-icon">🚪</span>
                <div className="item-text">
                  <span className="item-title">Sign Out</span>
                </div>
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
