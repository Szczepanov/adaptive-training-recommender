import React, { useRef, useEffect } from 'react';
import type { Screen } from '../types/navigation';
import { getAuthInstance } from '../firebase';
import { buildInfo } from '../buildInfo';

interface MobileNavProps {
  screen: Screen;
  handleNavigate: (screen: Screen) => void;
  loadDecisionInput: () => void;
  mobileMoreOpen: boolean;
  setMobileMoreOpen: React.Dispatch<React.SetStateAction<boolean>>;
}

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

  return (
    <>
      <nav className="bottom-nav">
        <button
          className={`nav-item ${screen === 'home' ? 'active' : ''}`}
          onClick={() => handleNavigate('home')}
        >
          <span className="nav-icon">🏠</span>
          <span className="nav-label">Today</span>
        </button>

        <button
          className={`nav-item ${screen === 'checkin' ? 'active' : ''}`}
          onClick={() => handleNavigate('checkin')}
        >
          <span className="nav-icon">✓</span>
          <span className="nav-label">Check-in</span>
        </button>

        <button
          className={`nav-item ${screen === 'plan' ? 'active' : ''}`}
          onClick={() => handleNavigate('plan')}
        >
          <span className="nav-icon">📋</span>
          <span className="nav-label">Plan</span>
        </button>

        <button
          ref={mobileMoreBtnRef}
          className={`nav-item ${['goals', 'constraints', 'preferences', 'data', 'brief', 'sessions', 'testing'].includes(screen) ? 'active' : ''}`}
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
              <button
                className={`drawer-item ${screen === 'goals' ? 'active' : ''}`}
                onClick={() => handleNavigate('goals')}
              >
                <span className="item-icon">🎯</span>
                <div className="item-text">
                  <span className="item-title">Goals & Target Events</span>
                  <span className="item-sub">Manage events and target milestones</span>
                </div>
              </button>

              <button
                className={`drawer-item ${screen === 'data' ? 'active' : ''}`}
                onClick={() => {
                  loadDecisionInput();
                  handleNavigate('data');
                }}
              >
                <span className="item-icon">📊</span>
                <div className="item-text">
                  <span className="item-title">Detailed Data</span>
                  <span className="item-sub">View analytics and snapshot telemetry</span>
                </div>
              </button>

              <button
                className={`drawer-item ${screen === 'constraints' ? 'active' : ''}`}
                onClick={() => handleNavigate('constraints')}
              >
                <span className="item-icon">⚠️</span>
                <div className="item-text">
                  <span className="item-title">Training Setup</span>
                  <span className="item-sub">Manage physical cautions & equipment</span>
                </div>
              </button>

              <button
                className={`drawer-item ${screen === 'preferences' ? 'active' : ''}`}
                onClick={() => handleNavigate('preferences')}
              >
                <span className="item-icon">⚙️</span>
                <div className="item-text">
                  <span className="item-title">Coach Preferences</span>
                  <span className="item-sub">Configure modalities & strain caps</span>
                </div>
              </button>

              <button
                className={`drawer-item ${screen === 'sessions' ? 'active' : ''}`}
                onClick={() => handleNavigate('sessions')}
              >
                <span className="item-icon">🚀</span>
                <div className="item-text">
                  <span className="item-title">Structured Sessions</span>
                  <span className="item-sub">Run a multidomain fixture and record native measures</span>
                </div>
              </button>

              <button
                className={`drawer-item ${screen === 'testing' ? 'active' : ''}`}
                onClick={() => handleNavigate('testing')}
              >
                <span className="item-icon">🧪</span>
                <div className="item-text">
                  <span className="item-title">Protocol Testing</span>
                  <span className="item-sub">Run a locked assessment and record comparable raw outcomes</span>
                </div>
              </button>

              <button
                className={`drawer-item ${screen === 'brief' ? 'active' : ''}`}
                onClick={() => {
                  loadDecisionInput();
                  handleNavigate('brief');
                }}
              >
                <span className="item-icon">📤</span>
                <div className="item-text">
                  <span className="item-title">Export Context for AI</span>
                  <span className="item-sub">Compile recent metrics & prompt for your AI</span>
                </div>
              </button>

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
