import { useState } from 'react';
import '../App.css';
import { DailyCheckin } from '../components/DailyCheckin';
import { DataView } from '../components/DataView';
import { Goals } from '../components/Goals';
import { Home } from '../components/Home';
import { Preferences } from '../components/Preferences';
import { StrengthSessionRunner } from '../components/StrengthSessionRunner';
import { TrainingSettings } from '../components/TrainingSettings';
import type { Screen } from '../types/navigation';
import { VISUAL_USER_ID, type VisualScenario, type VisualScreen } from './fixtures';

interface VisualReviewAppProps {
  scenario: VisualScenario;
}

function mapScreenToVisual(s: Screen): VisualScreen {
  if (s === 'strength') return 'session';
  if (s === 'plan' || s === 'brief') return 'home';
  return s;
}

export function VisualReviewApp({ scenario }: VisualReviewAppProps) {
  const [screen, setScreen] = useState<VisualScreen>(scenario.screen);
  const [desktopSettingsOpen, setDesktopSettingsOpen] = useState(false);
  const [mobileMoreOpen, setMobileMoreOpen] = useState(false);

  const navigate = (nextScreen: VisualScreen) => {
    setScreen(nextScreen);
    setDesktopSettingsOpen(false);
    setMobileMoreOpen(false);
  };

  const handleAppNavigate = (s: Screen) => {
    navigate(mapScreenToVisual(s));
  };

  return (
    <div className="app-container visual-review-app" data-visual-scenario={scenario.id}>
      <header className="global-navbar">
        <div className="navbar-container">
          <div className="navbar-left">
            <button className="navbar-brand" onClick={() => navigate('home')} title="Go to Home Dashboard">
              <span className="brand-icon">⚡</span>
              <span className="brand-name">Adaptive Coach</span>
            </button>
          </div>

          <nav className="navbar-desktop-menu" aria-label="Primary navigation">
            <button className={`nav-link ${screen === 'home' ? 'active' : ''}`} onClick={() => navigate('home')}>Home</button>
            <button className={`nav-link ${screen === 'checkin' ? 'active' : ''}`} onClick={() => navigate('checkin')}>Check-in</button>
            <button className={`nav-link ${screen === 'session' ? 'active' : ''}`} onClick={() => navigate('session')}>Session</button>
            <button className={`nav-link ${screen === 'goals' ? 'active' : ''}`} onClick={() => navigate('goals')}>Goals</button>
            <button className={`nav-link ${screen === 'data' ? 'active' : ''}`} onClick={() => navigate('data')}>Data</button>
            <div className="more-menu-container">
              <button
                className={`nav-link more-btn ${['constraints', 'preferences'].includes(screen) ? 'active' : ''}`}
                onClick={() => setDesktopSettingsOpen((isOpen) => !isOpen)}
                aria-expanded={desktopSettingsOpen}
                aria-haspopup="menu"
              >
                <span>Settings</span><span className="caret">▾</span>
              </button>
              {desktopSettingsOpen && (
                <div className="dropdown-menu" role="menu" aria-label="Settings">
                  <button className={`dropdown-item ${screen === 'constraints' ? 'active' : ''}`} onClick={() => navigate('constraints')} role="menuitem">Training Setup</button>
                  <button className={`dropdown-item ${screen === 'preferences' ? 'active' : ''}`} onClick={() => navigate('preferences')} role="menuitem">Coach Preferences</button>
                </div>
              )}
            </div>
          </nav>
        </div>
      </header>

      <main className="app-content">
        {screen === 'home' && <Home userId={VISUAL_USER_ID} onNavigate={handleAppNavigate} onViewData={() => navigate('data')} />}
        {screen === 'checkin' && <DailyCheckin userId={VISUAL_USER_ID} onNavigate={handleAppNavigate} onBack={() => navigate('home')} />}
        {screen === 'goals' && <Goals userId={VISUAL_USER_ID} onNavigate={handleAppNavigate} />}
        {screen === 'data' && <DataView decisionInput={scenario.fixture.input} userId={VISUAL_USER_ID} onBack={() => navigate('home')} initialTab={scenario.initialDataTab} />}
        {screen === 'constraints' && <TrainingSettings userId={VISUAL_USER_ID} />}
        {screen === 'preferences' && <Preferences userId={VISUAL_USER_ID} onNavigate={handleAppNavigate} />}
        {screen === 'session' && <StrengthSessionRunner userId={VISUAL_USER_ID} />}
      </main>

      <nav className="bottom-nav" aria-label="Mobile navigation">
        <button className={`nav-item ${screen === 'home' ? 'active' : ''}`} onClick={() => navigate('home')}><span className="nav-label">Home</span></button>
        <button className={`nav-item ${screen === 'checkin' ? 'active' : ''}`} onClick={() => navigate('checkin')}><span className="nav-label">Check-in</span></button>
        <button className={`nav-item ${screen === 'session' ? 'active' : ''}`} onClick={() => navigate('session')}><span className="nav-label">Session</span></button>
        <button className={`nav-item ${screen === 'goals' ? 'active' : ''}`} onClick={() => navigate('goals')}><span className="nav-label">Goals</span></button>
        <button className={`nav-item ${['constraints', 'preferences', 'data'].includes(screen) ? 'active' : ''}`} onClick={() => setMobileMoreOpen((isOpen) => !isOpen)} aria-expanded={mobileMoreOpen} aria-haspopup="dialog"><span className="nav-label">More</span></button>
      </nav>

      {mobileMoreOpen && (
        <div className="mobile-more-overlay" onClick={() => setMobileMoreOpen(false)}>
          <div className="mobile-more-drawer" role="dialog" aria-modal="true" aria-labelledby="visual-mobile-more-title" onClick={(event) => event.stopPropagation()}>
            <div className="drawer-header">
              <h3 id="visual-mobile-more-title">Navigation &amp; Settings</h3>
              <button className="close-drawer-btn" onClick={() => setMobileMoreOpen(false)} aria-label="Close navigation and settings">✕</button>
            </div>
            <div className="drawer-items">
              <button className={`drawer-item ${screen === 'data' ? 'active' : ''}`} onClick={() => navigate('data')}><div className="item-text"><span className="item-title">Detailed Data</span><span className="item-sub">View analytics and snapshot telemetry</span></div></button>
              <button className={`drawer-item ${screen === 'constraints' ? 'active' : ''}`} onClick={() => navigate('constraints')}><div className="item-text"><span className="item-title">Training Setup</span><span className="item-sub">Manage physical cautions and equipment</span></div></button>
              <button className={`drawer-item ${screen === 'preferences' ? 'active' : ''}`} onClick={() => navigate('preferences')}><div className="item-text"><span className="item-title">Coach Preferences</span><span className="item-sub">Configure modalities and recovery approach</span></div></button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
