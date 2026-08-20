import { useState } from 'react';
import '../App.css';
import { DailyCheckin } from '../components/DailyCheckin';
import { DataView } from '../components/DataView';
import { Goals } from '../components/Goals';
import { Home } from '../components/Home';
import { Preferences } from '../components/Preferences';
import { SessionRunner } from '../components/session/SessionRunner';
import { TrainingSettings } from '../components/TrainingSettings';
import { PlanView } from '../components/PlanView';
import { Header } from '../components/Header';
import { MobileNav } from '../components/MobileNav';
import type { Screen } from '../types/navigation';
import { VISUAL_USER_ID, type VisualScenario, type VisualScreen } from './fixtures';

interface VisualReviewAppProps {
  scenario: VisualScenario;
}

function mapScreenToVisual(s: Screen): VisualScreen {
  if (s === 'strength' || s === 'sessions') return 'session';
  if (s === 'brief') return 'home';
  if (s === 'plan') return 'plan';
  return s;
}

export function VisualReviewApp({ scenario }: VisualReviewAppProps) {
  const [screen, setScreen] = useState<VisualScreen>(scenario.screen);
  const [desktopSettingsOpen, setDesktopSettingsOpen] = useState(false);
  const [mobileMoreOpen, setMobileMoreOpen] = useState(false);

  const navigate = (next: VisualScreen) => {
    setScreen(next);
    setMobileMoreOpen(false);
  };

  const handleAppNavigate = (next: Screen) => {
    navigate(mapScreenToVisual(next));
  };

  const appScreen: Screen = screen === 'session' ? 'sessions' : screen;

  return (
    <div className="app-container" data-visual-scenario={scenario.id}>
      <Header
        screen={appScreen}
        handleNavigate={handleAppNavigate}
        loadDecisionInput={() => {}}
        desktopSettingsOpen={desktopSettingsOpen}
        setDesktopSettingsOpen={setDesktopSettingsOpen}
      />

      <main className="app-content">
        {screen === 'home' && <Home userId={VISUAL_USER_ID} onNavigate={handleAppNavigate} onViewData={() => navigate('data')} />}
        {screen === 'plan' && <PlanView userId={VISUAL_USER_ID} onNavigate={handleAppNavigate} />}
        {screen === 'checkin' && <DailyCheckin userId={VISUAL_USER_ID} onNavigate={handleAppNavigate} onBack={() => navigate('home')} />}
        {screen === 'goals' && <Goals userId={VISUAL_USER_ID} onNavigate={handleAppNavigate} />}
        {screen === 'data' && <DataView decisionInput={scenario.fixture.input} userId={VISUAL_USER_ID} onBack={() => navigate('home')} initialTab={scenario.initialDataTab} />}
        {screen === 'constraints' && <TrainingSettings userId={VISUAL_USER_ID} />}
        {screen === 'preferences' && <Preferences userId={VISUAL_USER_ID} onNavigate={handleAppNavigate} />}
        {screen === 'session' && (
          <SessionRunner
            userId={VISUAL_USER_ID}
            onClose={() => navigate('home')}
          />
        )}
      </main>

      <MobileNav
        screen={appScreen}
        handleNavigate={handleAppNavigate}
        loadDecisionInput={() => {}}
        mobileMoreOpen={mobileMoreOpen}
        setMobileMoreOpen={setMobileMoreOpen}
      />
    </div>
  );
}
