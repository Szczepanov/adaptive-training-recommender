import { useState, useEffect, useCallback, useRef, lazy, Suspense } from 'react';
import './App.css';
import './index.css';
import { Home } from './components/Home';
import type { PreparedSessionLaunch } from './components/session/SessionDestinationSheet';
import { decisionComposer } from './engine/composer';
import type { HealthAnomalyAssessmentRevision } from './engine/healthAnomalyModels';
import type { DailyDecisionInput } from './engine/models';
import type { SessionExecution, SessionIntent } from './sessions/models';
import type { Screen } from './types/navigation';
import { useAuth } from './contexts/AuthContext';
import { LoginScreen } from './components/LoginScreen';
import { Header } from './components/Header';
import { MobileNav } from './components/MobileNav';
import { getLocalDateString } from './utils/localDate';
import { strengthSessionService } from './services/strengthSessionService';
import { sessionExecutionService } from './services/sessionExecutionService';
import { runConfiguredHealthAnomalyShadow } from './services/healthAnomalyRuntime';
import { resolveSessionDefinition } from './sessions/sessionDefinitionResolver';

const DailyCheckin = lazy(() => import('./components/DailyCheckin').then(m => ({ default: m.DailyCheckin })));
const Goals = lazy(() => import('./components/Goals').then(m => ({ default: m.Goals })));
const TrainingSettings = lazy(() => import('./components/TrainingSettings').then(m => ({ default: m.TrainingSettings })));
const Preferences = lazy(() => import('./components/Preferences').then(m => ({ default: m.Preferences })));
const DataView = lazy(() => import('./components/DataView').then(m => ({ default: m.DataView })));
const HealthAnomalyShadowPanel = lazy(() => import('./components/HealthAnomalyShadowPanel').then(m => ({ default: m.HealthAnomalyShadowPanel })));
const PlanView = lazy(() => import('./components/PlanView').then(m => ({ default: m.PlanView })));
const StrengthOverloadHistory = lazy(() => import('./components/StrengthOverloadHistory').then(m => ({ default: m.StrengthOverloadHistory })));
const SessionRunner = lazy(() => import('./components/session/SessionRunner').then(m => ({ default: m.SessionRunner })));
const ManualSessionBuilder = lazy(() => import('./components/session/ManualSessionBuilder').then(m => ({ default: m.ManualSessionBuilder })));
const SessionJsonImport = lazy(() => import('./components/session/SessionJsonImport').then(m => ({ default: m.SessionJsonImport })));
const TestingWorkflow = lazy(() => import('./components/testing/TestingWorkflow').then(m => ({ default: m.TestingWorkflow })));

function App() {
  const { userId, authPhase } = useAuth();
  const [screen, setScreen] = useState<Screen>('home');
  const [decisionInput, setDecisionInput] = useState<DailyDecisionInput | null>(null);
  const [healthAnomalyShadowRevision, setHealthAnomalyShadowRevision] = useState<HealthAnomalyAssessmentRevision | null>(null);
  const [desktopSettingsOpen, setDesktopSettingsOpen] = useState(false);
  const [mobileMoreOpen, setMobileMoreOpen] = useState(false);
  const hasResolvedInitialScreen = useRef(false);
  const lastResolvedDate = useRef<string | null>(null);
  const userNavigatedExplicitly = useRef(false);
  // M3.4/M2.7 cutover: legacy Strength v1 remains a permanent read format, but it no longer
  // owns a second live runner. An already-open pre-cutover document is surfaced only so the
  // athlete can close it without losing its partial sets; all new execution uses SessionRunner.
  const [legacyStrengthSessionId, setLegacyStrengthSessionId] = useState<string | null>(null);
  const [activeStructuredSession, setActiveStructuredSession] = useState<SessionExecution | null>(null);
  const [activeStructuredIntent, setActiveStructuredIntent] = useState<SessionIntent | null>(null);
  const [sessionAuthoringMode, setSessionAuthoringMode] = useState<'import' | 'manual' | null>(null);
  const [sessionLaunch, setSessionLaunch] = useState<PreparedSessionLaunch | null>(null);

  const loadDecisionInput = useCallback(async () => {
    if (!userId) return;
    try {
      const input = await decisionComposer.composeDailyDecisionInput(userId);
      setDecisionInput(input);

      // Check-in first routing: on initial boot or calendar day rollover, route to check-in if pending
      const isNewDay = lastResolvedDate.current !== null && lastResolvedDate.current !== input.date;
      if (!hasResolvedInitialScreen.current || isNewDay) {
        hasResolvedInitialScreen.current = true;
        lastResolvedDate.current = input.date;
        const isCheckinIncomplete = !input.dataQuality.hasSubjectiveCheckin || !input.dataQuality.subjectiveCheckinComplete;
        if (!userNavigatedExplicitly.current || isNewDay) {
          if (isCheckinIncomplete) {
            setScreen('checkin');
          } else if (!userNavigatedExplicitly.current) {
            setScreen('home');
          }
        }
      }

      // HA-D evidence collection is deliberately fire-and-forget relative to readiness.
      // Only an explicit shadow-v1 runtime value reaches the HA service, and the result is
      // retained solely so the Detailed Data trace can update after immutable persistence.
      void runConfiguredHealthAnomalyShadow(userId, input.date)
        .then(result => {
          if (result) setHealthAnomalyShadowRevision(result.revision);
        })
        .catch(error => {
          console.error('Error collecting health anomaly shadow evidence:', error);
        });
    } catch (error) {
      console.error('Error loading decision input:', error);
    }
  }, [userId]);

  useEffect(() => {
    if (userId && authPhase === 'AUTHENTICATED') {
      loadDecisionInput();
    }
  }, [userId, authPhase, loadDecisionInput]);

  useEffect(() => {
    // Clear synchronously on every identity change so a resolved session from a previous
    // account can never be shown, or acted on, under a newly signed-in userId.
    hasResolvedInitialScreen.current = false;
    lastResolvedDate.current = null;
    userNavigatedExplicitly.current = false;
    setLegacyStrengthSessionId(null);
    setActiveStructuredSession(null);
    setActiveStructuredIntent(null);
    if (!userId || authPhase !== 'AUTHENTICATED') return;
    let cancelled = false;
    Promise.allSettled([
      // Read-only cutover check. We retain the legacy service so an in-progress v1 document
      // can be closed explicitly, but no production path starts or resumes it in the old UI.
      strengthSessionService.findActiveSession(userId),
      sessionExecutionService.findInProgressExecution(userId),
    ]).then(async ([strengthResult, structuredResult]) => {
      if (cancelled) return;
      const legacyStrength = strengthResult.status === 'fulfilled' ? strengthResult.value : null;
      setLegacyStrengthSessionId(legacyStrength?.sessionId ?? null);
      const structured = structuredResult.status === 'fulfilled' ? structuredResult.value : null;
      setActiveStructuredSession(structured);
      setActiveStructuredIntent(null);
      if (structured?.prescriptionHash) {
        try {
          const definition = await resolveSessionDefinition(userId, structured.sessionSource, structured.prescriptionHash);
          if (!cancelled && definition.status === 'AVAILABLE') setActiveStructuredIntent(definition.data.intent);
        } catch {
          // Resume remains available as a generic structured session if the exact definition
          // cannot currently be resolved; the runner itself retains the fail-closed handling.
        }
      }
    });
    return () => { cancelled = true; };
  }, [userId, authPhase]);

  if (authPhase !== 'AUTHENTICATED') {
    return <LoginScreen />;
  }

  const handleNavigate = (newScreen: Screen) => {
    userNavigatedExplicitly.current = true;
    setScreen(newScreen);
    setDesktopSettingsOpen(false);
    setMobileMoreOpen(false);
  };

  const isWorkoutRunnerActive =
    (screen === 'sessions' || screen === 'testing') && activeStructuredSession?.state === 'in_progress';

  return (
    <div className="app-container">
      {!isWorkoutRunnerActive && (
        <Header
          screen={screen}
          handleNavigate={handleNavigate}
          loadDecisionInput={loadDecisionInput}
          desktopSettingsOpen={desktopSettingsOpen}
          setDesktopSettingsOpen={setDesktopSettingsOpen}
          userId={userId}
          date={decisionInput?.date ?? getLocalDateString()}
        />
      )}

      {legacyStrengthSessionId && !isWorkoutRunnerActive && (
        <div className="active-session-banner" role="status">
          <span>Legacy Strength session is still open. Its logged sets are preserved.</span>
          <button
            type="button"
            onClick={() => {
              const sessionId = legacyStrengthSessionId;
              void strengthSessionService.transitionState(userId!, sessionId, 'abandoned')
                .then(() => setLegacyStrengthSessionId(current => current === sessionId ? null : current))
                .catch(error => console.error('Failed to close legacy Strength session:', error));
            }}
          >
            Close legacy session
          </button>
        </div>
      )}
      {activeStructuredSession?.state === 'in_progress'
        && screen !== 'sessions'
        && screen !== 'testing'
        && (
          <div className="active-session-banner" role="status">
            <span>{activeStructuredIntent === 'testing' ? 'Protocol test in progress' : 'Structured session in progress'}</span>
            <button type="button" onClick={() => handleNavigate(activeStructuredIntent === 'testing' ? 'testing' : 'sessions')}>Resume session</button>
          </div>
        )}

      <main className="app-content">
        <Suspense fallback={<div className="loading-state">Loading...</div>}>
          {screen === 'home' && (
            <Home
              userId={userId!}
              onNavigate={handleNavigate}
              onViewData={() => {
                loadDecisionInput();
                handleNavigate('data');
              }}
              onStartSession={async binding => {
                const definitionState = await resolveSessionDefinition(
                  userId!,
                  binding.sessionSource,
                  binding.prescriptionHash,
                );
                if (definitionState.status !== 'AVAILABLE') {
                  console.error(`Unable to resolve the stored session prescription: ${definitionState.status}`);
                  return;
                }
                const launch = { definition: definitionState.data, binding };
                setSessionLaunch(launch);
                handleNavigate('sessions');
              }}
            />
          )}

          {screen === 'data' && (
            <>
              <DataView
                decisionInput={decisionInput}
                userId={userId!}
                onBack={() => handleNavigate('home')}
              />
              {decisionInput && (
                <HealthAnomalyShadowPanel
                  userId={userId!}
                  decisionInput={decisionInput}
                  liveRevision={healthAnomalyShadowRevision}
                />
              )}
            </>
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
              onCheckinSaved={loadDecisionInput}
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
              <>
                <SessionRunner
                  userId={userId!}
                  initialSession={sessionLaunch ?? undefined}
                  onInitialSessionHandled={() => setSessionLaunch(null)}
                  onImportSession={() => setSessionAuthoringMode('import')}
                  onBuildSession={() => setSessionAuthoringMode('manual')}
                  onSessionStateChange={session => {
                    setActiveStructuredSession(session?.state === 'in_progress' ? session : null);
                    if (session?.state !== 'in_progress') setActiveStructuredIntent(null);
                  }}
                  onClose={() => handleNavigate('home')}
                />
                <details className="strength-history-disclosure">
                  <summary>View strength history</summary>
                  <StrengthOverloadHistory userId={userId!} />
                </details>
              </>
            )
          )}

          {screen === 'testing' && (
            <TestingWorkflow
              userId={userId!}
              onSessionStateChange={session => {
                setActiveStructuredSession(session?.state === 'in_progress' ? session : null);
                setActiveStructuredIntent(session?.state === 'in_progress' ? 'testing' : null);
              }}
              onClose={() => handleNavigate('home')}
            />
          )}

          {screen === 'plan' && (
            <PlanView
              userId={userId!}
              onNavigate={setScreen}
              onPlanChanged={() => {
                loadDecisionInput();
              }}
            />
          )}
        </Suspense>
      </main>

      {!(
        screen === 'checkin' ||
        isWorkoutRunnerActive
      ) && (
        <MobileNav
          screen={screen}
          handleNavigate={handleNavigate}
          loadDecisionInput={loadDecisionInput}
          mobileMoreOpen={mobileMoreOpen}
          setMobileMoreOpen={setMobileMoreOpen}
        />
      )}
    </div>
  );
}

export default App;
