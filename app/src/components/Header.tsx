import React, { useRef, useEffect } from 'react';
import type { Screen } from '../types/navigation';
import { SCREEN_LABELS } from '../types/navigation';
import { DRAWER_GROUPS, type DrawerDestination } from './navigationGroups';
import { getAuthInstance } from '../firebase';
import { buildInfo } from '../buildInfo';
import { GarminSyncBadge } from './GarminSyncBadge';

interface HeaderProps {
  screen: Screen;
  handleNavigate: (screen: Screen) => void;
  loadDecisionInput: () => void;
  desktopSettingsOpen: boolean;
  setDesktopSettingsOpen: React.Dispatch<React.SetStateAction<boolean>>;
  userId?: string | null;
  date?: string;
}

export const Header: React.FC<HeaderProps> = ({
  screen,
  handleNavigate,
  loadDecisionInput,
  desktopSettingsOpen,
  setDesktopSettingsOpen,
  userId,
  date,
}) => {
  const desktopSettingsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      if (!desktopSettingsRef.current?.contains(event.target as Node)) {
        setDesktopSettingsOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (desktopSettingsOpen) setDesktopSettingsOpen(false);
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [desktopSettingsOpen, setDesktopSettingsOpen]);

  const handleLogout = async () => {
    const { signOut } = await import('firebase/auth');
    await signOut(getAuthInstance());
  };

  const buildTitle = `Git commit ${buildInfo.gitSha}${buildInfo.dirty ? ' (local working tree has uncommitted changes)' : ''}`;

  // Daily-loop primaries own the desktop top level (#482), mirroring the
  // mobile bottom bar. Every other destination lives in the More overflow
  // under the same intent groups as the mobile drawer, so muscle memory
  // transfers between form factors.
  const moreMenuActive = screen !== 'home' && screen !== 'checkin' && screen !== 'plan';

  const navigateToOverflowDestination = (destination: DrawerDestination) => {
    if (destination.refreshDecisionInput) {
      loadDecisionInput();
    }
    handleNavigate(destination.screen);
  };

  return (
    <header className="global-navbar">
      <div className="navbar-container">
        <div className="navbar-left">
          <button
            className="navbar-brand"
            onClick={() => handleNavigate('home')}
            title="Go to Home Dashboard"
          >
            <span className="brand-icon">⚡</span>
            <span className="brand-name">Adaptive Coach</span>
          </button>
          {userId && <GarminSyncBadge userId={userId} date={date} onSynced={loadDecisionInput} />}
        </div>

        <nav className="navbar-desktop-menu" aria-label="Primary">
          <button
            className={`nav-link ${screen === 'home' ? 'active' : ''}`}
            onClick={() => handleNavigate('home')}
          >
            {SCREEN_LABELS.home}
          </button>
          <button
            className={`nav-link ${screen === 'checkin' ? 'active' : ''}`}
            onClick={() => handleNavigate('checkin')}
          >
            {SCREEN_LABELS.checkin}
          </button>
          <button
            className={`nav-link ${screen === 'plan' ? 'active' : ''}`}
            onClick={() => handleNavigate('plan')}
          >
            {SCREEN_LABELS.plan}
          </button>

          <div className="more-menu-container" ref={desktopSettingsRef}>
            <button
              className={`nav-link more-btn ${moreMenuActive ? 'active' : ''}`}
              onClick={() => setDesktopSettingsOpen((isOpen) => !isOpen)}
              aria-expanded={desktopSettingsOpen}
              aria-haspopup="menu"
            >
              <span>More</span>
              <span className="caret">▾</span>
            </button>

            {desktopSettingsOpen && (
              <div className="dropdown-menu" role="menu" aria-label="More">
                {DRAWER_GROUPS.map((group) => (
                  <div key={group.id} role="group" aria-label={group.title}>
                    <div className="dropdown-group-title">{group.title}</div>
                    {group.items.map((destination) => (
                      <button
                        key={destination.screen}
                        className={`dropdown-item ${screen === destination.screen ? 'active' : ''}`}
                        onClick={() => navigateToOverflowDestination(destination)}
                        role="menuitem"
                      >
                        <span className="item-icon">{destination.icon}</span> {SCREEN_LABELS[destination.screen]}
                      </button>
                    ))}
                  </div>
                ))}
                <div className="dropdown-divider" />
                <div
                  className="dropdown-item"
                  title={buildTitle}
                  aria-label={`Build ${buildInfo.label}`}
                  style={{ cursor: 'default', opacity: 0.72 }}
                >
                  <span className="item-icon">ℹ️</span> Build {buildInfo.label}
                </div>
                <div className="dropdown-divider" />
                <button className="dropdown-item logout" onClick={handleLogout} role="menuitem">
                  <span className="item-icon">🚪</span> Sign Out
                </button>
              </div>
            )}
          </div>
        </nav>

      </div>
    </header>
  );
};
