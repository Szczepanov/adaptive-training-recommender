import React, { useRef, useEffect } from 'react';
import type { Screen } from '../types/navigation';
import { getAuthInstance } from '../firebase';

interface HeaderProps {
  screen: Screen;
  handleNavigate: (screen: Screen) => void;
  loadDecisionInput: () => void;
  desktopSettingsOpen: boolean;
  setDesktopSettingsOpen: React.Dispatch<React.SetStateAction<boolean>>;
}

export const Header: React.FC<HeaderProps> = ({ screen, handleNavigate, loadDecisionInput, desktopSettingsOpen, setDesktopSettingsOpen }) => {
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
        </div>

        <nav className="navbar-desktop-menu">
          <button
            className={`nav-link ${screen === 'home' ? 'active' : ''}`}
            onClick={() => handleNavigate('home')}
          >
            Home
          </button>
          <button
            className={`nav-link ${screen === 'checkin' ? 'active' : ''}`}
            onClick={() => handleNavigate('checkin')}
          >
            Check-in
          </button>
          <button
            className={`nav-link ${screen === 'goals' ? 'active' : ''}`}
            onClick={() => handleNavigate('goals')}
          >
            Goals
          </button>
          <button
            className={`nav-link ${screen === 'data' ? 'active' : ''}`}
            onClick={() => {
              loadDecisionInput();
              handleNavigate('data');
            }}
          >
            Data
          </button>

          <div className="more-menu-container" ref={desktopSettingsRef}>
            <button
              className={`nav-link more-btn ${['constraints', 'preferences'].includes(screen) ? 'active' : ''}`}
              onClick={() => setDesktopSettingsOpen((isOpen) => !isOpen)}
              aria-expanded={desktopSettingsOpen}
              aria-haspopup="menu"
            >
              <span>Settings</span>
              <span className="caret">▾</span>
            </button>

            {desktopSettingsOpen && (
              <div className="dropdown-menu" role="menu" aria-label="Settings">
                <button
                  className={`dropdown-item ${screen === 'constraints' ? 'active' : ''}`}
                  onClick={() => handleNavigate('constraints')}
                  role="menuitem"
                >
                  <span className="item-icon">⚙️</span> Training Setup
                </button>
                <button
                  className={`dropdown-item ${screen === 'preferences' ? 'active' : ''}`}
                  onClick={() => handleNavigate('preferences')}
                  role="menuitem"
                >
                  <span className="item-icon">⚙️</span> Coach Preferences
                </button>
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
