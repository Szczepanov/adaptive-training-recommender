import { useState, useEffect, useCallback } from 'react';
import './App.css';
import './index.css';
import { Home } from './components/Home';
import { DailyCheckin } from './components/DailyCheckin';
import { Goals } from './components/Goals';
import { TrainingSettings } from './components/TrainingSettings';
import { Preferences } from './components/Preferences';
import { DataView } from './components/DataView';
import { ExternalPlanImport } from './components/ExternalPlanImport';
import { StrengthOverloadHistory } from './components/StrengthOverloadHistory';
import { StrengthSessionRunner } from './components/StrengthSessionRunner';
import { SessionRunner } from './components/session/SessionRunner';
import { ManualSessionBuilder } from './components/session/ManualSessionBuilder';
import { SessionJsonImport } from './components/session/SessionJsonImport';
import type { PreparedSessionLaunch } from './components/session/SessionDestinationSheet';
import { decisionComposer } from './engine/composer';
import type { DailyDecisionInput, StrengthSession } from './engine/models';
import type { SessionExecution } from './sessions/models';
import type { Screen } from './types/navigation';
import { useAuth } from './contexts/AuthContext';
import { LoginScreen } from './components/LoginScreen';
import { Header } from './components/Header';
import { MobileNav } from './components/MobileNav';
import { getLocalDateString } from './utils/localDate';
import { strengthSessionService } from './services/strengthSessionService';
import { sessionExecutionService } from './services/sessionExecutionService';

function App() {
  const { userId, authPhase } = useAuth();
  const [screen, setScreen] = useState<Screen>('home');
  const [decisionInput, setDecisionInput] = useState<DailyDecisionInput | null>(null);
  const [desktopSettingsOpen, setDesktopSettingsOpen] = useState(false);
  const [mobileMoreOpen, setMobileMoreOpen] = useState(false);
  const [activeStrengthSession, setActiveStrengthSession] = useState<StrengthSession | null>(null);
  const [activeStructuredSession, setActiveStructuredSession] = useState<SessionExecution | null>(null);
  const [sessionAuthoringMode, setSessionAuthoringMode] = useState<'import' | 'manual' | null>(null);
  const [sessionLaunch, setSessionLaunch] = useState<PreparedSessionLaunch | null>(null);

  const loadDecisionInput = useCallback(async () => {
    if (!userId) return;
    try {
      const input = await decisionComposer.composeDailyDecisionInput(userId);
      setDecisionInput(input);
    } catch (error) {
      console.error('Error loading decision input:', error);
    }
  }, [userId]);

  // Load decision input when authenticated
  useEffect(() => {
    if (userId && authPhase === 'AUTHENTICATED') {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      loadDecisionInput();
    }
  }, [userId, authPhase, loadDecisionInput]);

  useEffect(() => {
    if (!userId || authPhase !== 'AUTHENTICATED') return;
    let cancelled = false;
    Promise.allSettled([
      strengthSessionService.findActiveSession(userId),
      sessionExecutionService.findInProgressExecution(userId),
    ]).then(([strengthResult, structuredResult]) => {
      if (cancelled) return;
      setActiveStrengthSession(strengthResult.status === 'fulfilled' ? strengthResult.value : null);
      setActiveStructuredSession(structuredResult.status === 'fulfilled' ? structuredResult.value : null);
    });
    return () => { cancelled = true; };
  }, [userId, authPhase]);

  if (authPhase !== 'AUTHENTICATED') {
    return <LoginScreen />;
  }

  const handleNavigate = (newScreen: Screen) => {
    setScreen(newScreen);
    setDesktopSettingsOpen(false);
    setMobileMoreOpen(false);
  };

  // Main app with navigation
  return (
    <div className="app-container">
      {/* Global Top Navbar */}
      <Header
        screen={screen}
        handleNavigate={handleNavigate}
        loadDecisionInput={loadDecisionInput}
        desktopSettingsOpen={desktopSettingsOpen}
        setDesktopSettingsOpen={setDesktopSettingsOpen}
        userId={userId}
        date={decisionInput?.date ?? getLocalDateString()}
      />

      {activeStrengthSession?.state === 'in_progress' && screen !== 'strength' && (
        <div className="active-session-banner" role="status">
          <span>Strength session in progress</span>
          <button type="button" onClick={() => handleNavigate('strength')}>Resume session</button>
        </div>
      )}
      {activeStructuredSession?.state === 'in_progress' && screen !== 'sessions' && (
        <div className="active-session-banner" role="status">
          <span>Structured session in progress</span>
          <button type="button" onClick={() => handleNavigate('sessions')}>Resume session</button>
        </div>
      )}

      {/* Main Page Content */}
      <main className="app-content">
        {screen === 'home' && (
          <Home
            userId={userId!}
            onNavigate={handleNavigate}
            onViewData={() => {
              loadDecisionInput();
              handleNavigate('data');
            }}
            onStartCatalogSession={launch => {
              // The source-neutral runner has not yet reached ADR-0021 parity for catalog
              // Strength (RIR/velocity/technical gauges, prior-set context and 1RM
              // write-back). Keep the v1 runner for that source until parity lands.
              if (launch.definition.dominantModality === 'strength') {
                handleNavigate('strength');
              } else {
                setSessionLaunch(launch);
                handleNavigate('sessions');
              }
            }}
          />
        )}
        
        {screen === 'data' && (
          <DataView
            decisionInput={decisionInput}
            userId={userId!}
            onBack={() => handleNavigate('home')}
          />
        )}

        {screen === 'brief' && (
          <DataView
            decisionInput={decisionInput}
            userId={userId!}
            initialTab="brief"
            onBack={() => handleNavigate('home')}
          />
        )}
        
        {screen === 'checkin' && (
          <DailyCheckin 
            userId={userId!} 
            onNavigate={handleNavigate}
            onBack={() => handleNavigate('home')}
          />
        )}
        
        {screen === 'goals' && (
          <Goals userId={userId!} onNavigate={handleNavigate} />
        )}
        
        {screen === 'constraints' && (
          <TrainingSettings userId={userId!} />
        )}
        
        {screen === 'preferences' && (
          <Preferences userId={userId!} onNavigate={handleNavigate} />
        )}

        {screen === 'strength' && (
          <div className="strength-screen">
            <StrengthSessionRunner
              userId={userId!}
              onSessionStateChange={session => setActiveStrengthSession(session?.state === 'in_progress' ? session : null)}
            />
            <details className="strength-history-disclosure">
              <summary>View strength history</summary>
              <StrengthOverloadHistory userId={userId!} />
            </details>
          </div>
        )}

        {screen === 'sessions' && (
          sessionAuthoringMode === 'import' ? (
            <SessionJsonImport
              userId={userId!}
              onClose={() => setSessionAuthoringMode(null)}
              onStartExecution={session => {
                setSessionLaunch(session);
                setSessionAuthoringMode(null);
              }}
            />
          ) : sessionAuthoringMode === 'manual' ? (
            <ManualSessionBuilder
              userId={userId!}
              onClose={() => setSessionAuthoringMode(null)}
              onStartExecution={session => {
                setSessionLaunch(session);
                setSessionAuthoringMode(null);
              }}
            />
          ) : (
            <SessionRunner
              userId={userId!}
              initialSession={sessionLaunch ?? undefined}
              onInitialSessionHandled={() => setSessionLaunch(null)}
              onImportSession={() => setSessionAuthoringMode('import')}
              onBuildSession={() => setSessionAuthoringMode('manual')}
              onSessionStateChange={session => setActiveStructuredSession(session?.state === 'in_progress' ? session : null)}
              onClose={() => handleNavigate('home')}
            />
          )
        )}

        {screen === 'plan' && (
          <ExternalPlanImport
            userId={userId!}
            onImported={() => {
              // The imported plan changes what today's decision is made from, so the
              // composed input has to be refetched rather than left stale behind the nav.
              loadDecisionInput();
            }}
          />
        )}
      </main>

      {/* Mobile Bottom Navigation */}
      <MobileNav
        screen={screen}
        handleNavigate={handleNavigate}
        loadDecisionInput={loadDecisionInput}
        mobileMoreOpen={mobileMoreOpen}
        setMobileMoreOpen={setMobileMoreOpen}
      />
    </div>
  );
}

export default App;
