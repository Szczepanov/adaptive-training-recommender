import { useEffect, useState } from 'react';
import '../App.css';
import { DailyCheckin } from '../components/DailyCheckin';
import { DataView } from '../components/DataView';
import { Goals } from '../components/Goals';
import { Home } from '../components/Home';
import { Preferences } from '../components/Preferences';
import { SessionRunner } from '../components/session/SessionRunner';
import { ManualSessionBuilder } from '../components/session/ManualSessionBuilder';
import { TrainingSettings } from '../components/TrainingSettings';
import { PlanView } from '../components/PlanView';
import { Header } from '../components/Header';
import { MobileNav } from '../components/MobileNav';
import type { Screen } from '../types/navigation';
import { VISUAL_USER_ID, type VisualScenario, type VisualScreen } from './fixtures';
import { prepareCatalogSessionLaunch } from '../services/sessionAuthoringService';
import type { SessionDefinition, SessionReferenceBinding } from '../sessions/models';

interface VisualReviewAppProps {
  scenario: VisualScenario;
}

function mapScreenToVisual(s: Screen): VisualScreen {
  if (s === 'sessions') return 'session';
  if (s === 'brief' || s === 'testing') return 'home';
  if (s === 'plan') return 'plan';
  return s;
}

export function VisualReviewApp({ scenario }: VisualReviewAppProps) {
  const [screen, setScreen] = useState<VisualScreen>(scenario.screen);
  const [desktopSettingsOpen, setDesktopSettingsOpen] = useState(false);
  const [mobileMoreOpen, setMobileMoreOpen] = useState(false);
  const [sessionExecution, setSessionExecution] = useState<{ state: string } | null>(null);
  const [initialSessionError, setInitialSessionError] = useState(false);
  const [preparedInitialSession, setPreparedInitialSession] = useState<{
    definition: SessionDefinition;
    binding: SessionReferenceBinding;
  }>();

  useEffect(() => {
    const initialSession = scenario.fixture.initialSession;
    let disposed = false;
    if (!initialSession) {
      setPreparedInitialSession(undefined);
      setInitialSessionError(false);
      return () => { disposed = true; };
    }
    if ('prescription' in initialSession) {
      setPreparedInitialSession(undefined);
      setInitialSessionError(false);
      void prepareCatalogSessionLaunch(VISUAL_USER_ID, initialSession.prescription)
        .then(launch => {
          if (!disposed) setPreparedInitialSession(launch);
        })
        .catch(() => {
          if (!disposed) setInitialSessionError(true);
        });
    } else {
      setPreparedInitialSession(initialSession);
      setInitialSessionError(false);
    }
    return () => { disposed = true; };
  }, [scenario.fixture.initialSession]);

  const navigate = (next: VisualScreen) => {
    setScreen(next);
    setMobileMoreOpen(false);
  };

  const handleAppNavigate = (next: Screen) => {
    navigate(mapScreenToVisual(next));
  };

  const appScreen: Screen = screen === 'session' || screen === 'builder' ? 'sessions' : screen;
  const isWorkoutRunnerActive = screen === 'session' && sessionExecution?.state === 'in_progress';
  const isCheckin = screen === 'checkin';

  return (
    <div className="app-container" data-visual-scenario={scenario.id}>
      {!isWorkoutRunnerActive && (
        <Header
          screen={appScreen}
          handleNavigate={handleAppNavigate}
          loadDecisionInput={() => {}}
          desktopSettingsOpen={desktopSettingsOpen}
          setDesktopSettingsOpen={setDesktopSettingsOpen}
        />
      )}

      <main className="app-content">
        {screen === 'home' && <Home userId={VISUAL_USER_ID} onNavigate={handleAppNavigate} onViewData={() => navigate('data')} />}
        {screen === 'plan' && <PlanView userId={VISUAL_USER_ID} onNavigate={handleAppNavigate} />}
        {screen === 'checkin' && <DailyCheckin userId={VISUAL_USER_ID} onNavigate={handleAppNavigate} onBack={() => navigate('home')} />}
        {screen === 'goals' && <Goals userId={VISUAL_USER_ID} />}
        {screen === 'data' && <DataView decisionInput={scenario.fixture.input} userId={VISUAL_USER_ID} onBack={() => navigate('home')} initialTab={scenario.initialDataTab} />}
        {screen === 'constraints' && <TrainingSettings userId={VISUAL_USER_ID} />}
        {screen === 'preferences' && <Preferences userId={VISUAL_USER_ID} onNavigate={handleAppNavigate} />}
        {screen === 'builder' && <ManualSessionBuilder
          userId={VISUAL_USER_ID}
          initialDefinition={scenario.builderDefinition}
          onClose={() => navigate('session')}
          onStartExecution={() => navigate('session')}
        />}
        {screen === 'session' && initialSessionError && (
          <div className="session-runner-container" role="alert">
            Unable to prepare the catalog session for visual review.
          </div>
        )}
        {screen === 'session' && !initialSessionError && (
          <SessionRunner
            userId={VISUAL_USER_ID}
            initialSession={preparedInitialSession}
            onSessionStateChange={setSessionExecution}
            onClose={() => navigate('home')}
          />
        )}
      </main>

      {!(isCheckin || isWorkoutRunnerActive) && (
        <MobileNav
          screen={appScreen}
          handleNavigate={handleAppNavigate}
          loadDecisionInput={() => {}}
          mobileMoreOpen={mobileMoreOpen}
          setMobileMoreOpen={setMobileMoreOpen}
        />
      )}
    </div>
  );
}
