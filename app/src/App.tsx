import { useState, useEffect, useCallback, useRef, lazy, Suspense } from 'react';
import './App.css';
import './index.css';
import type { PreparedSessionLaunch } from './components/session/SessionDestinationSheet';
import { decisionComposer } from './engine/composer';
import { hasCompletedSubjectiveCheckinForDecision } from './engine/checkinCompletion';
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

const Home = lazy(() => import('./components/Home').then(m => ({ default: m.Home })));
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
  const [initialRouteUserId, setInitialRouteUserId] = useState<string | null>(null);
  const initialRouteUserIdRef = useRef<string | null>(null);
  const lastRoutedDate = useRef<string | null>(null);
  const decisionInputRequestRevision = useRef(0);
  const activeUserIdRef = useRef<string | null>(userId);
  const currentScreenRef = useRef<Screen>(screen);
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
    const requestUserId = userId;
    const requestRevision = ++decisionInputRequestRevision.current;

    try {
      const input = await decisionComposer.composeDailyDecisionInput(requestUserId);
      if (
        activeUserIdRef.current !== requestUserId
        || decisionInputRequestRevision.current !== requestRevision
      ) {
        return;
      }

      setDecisionInput(input);

      // The initial route is resolved before the dashboard is allowed to mount, avoiding a
      // flash (and unnecessary recommendation work) on Home before a pending check-in wins.
      // On a later calendar day we only auto-route while the athlete is already on Home or
      // Check-in, so a refresh can never eject an in-progress session or another workflow.
      const needsInitialRoute = initialRouteUserIdRef.current !== requestUserId;
      const needsDailyRoute = lastRoutedDate.current !== input.date;
      const isSafeAutoRouteScreen = currentScreenRef.current === 'home' || currentScreenRef.current === 'checkin';
      if (needsInitialRoute || (needsDailyRoute && isSafeAutoRouteScreen)) {
        const nextScreen: Screen = hasCompletedSubjectiveCheckinForDecision(input) ? 'home' : 'checkin';
        currentScreenRef.current = nextScreen;
        setScreen(nextScreen);
        initialRouteUserIdRef.current = requestUserId;
        lastRoutedDate.current = input.date;
        setInitialRouteUserId(requestUserId);
      }

      // HA-D evidence collection is deliberately fire-and-forget relative to readiness.
      // Only an explicit shadow-v1 runtime value reaches the HA service, and the result is
      // retained solely so the Detailed Data trace can update after immutable persistence.
      void runConfiguredHealthAnomalyShadow(requestUserId, input.date)
        .then(result => {
          if (
            result
            && activeUserIdRef.current === requestUserId
            && decisionInputRequestRevision.current === requestRevision
          ) {
            setHealthAnomalyShadowRevision(result.revision);
          }
        })
        .catch(error => {
          console.error('Error collecting health anomaly shadow evidence:', error);
        });
    } catch (error) {
      if (
        activeUserIdRef.current !== requestUserId
        || decisionInputRequestRevision.current !== requestRevision
      ) {
        return;
      }
      console.error('Error loading decision input:', error);
      // If the initial composition is unavailable we cannot prove today's check-in is
      // complete, so fail toward Check-in. That screen reads the daily document directly
      // and still exposes a Dashboard escape hatch if its own data source is unavailable.
      if (initialRouteUserIdRef.current !== requestUserId) {
        initialRouteUserIdRef.current = requestUserId;
        lastRoutedDate.current = getLocalDateString();
        currentScreenRef.current = 'checkin';
        setScreen('checkin');
        setInitialRouteUserId(requestUserId);
      }
    }
  }, [userId]);

  useEffect(() => {
    // Keep the async identity guard in effect-space rather than mutating a ref during render.
    // This effect is declared before the load effect below, so a newly authenticated identity
    // is installed before its first decision composition starts.
    activeUserIdRef.current = userId;

    // Invalidate any outstanding decision composition before resetting identity-scoped UI.
    // This prevents a slow response from the previous account (or an older same-account
    // refresh) from replacing current decision data or driving navigation after the switch.
    decisionInputRequestRevision.current += 1;
    initialRouteUserIdRef.current = null;
    lastRoutedDate.current = null;
    setInitialRouteUserId(null);
    setDecisionInput(null);
    setHealthAnomalyShadowRevision(null);

    // Clear synchronously on every identity change so a resolved session from a previous
    // account can never be shown, or acted on, under a newly signed-in userId.
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

  useEffect(() => {
    if (userId && authPhase === 'AUTHENTICATED') {
      void loadDecisionInput();
    }
  }, [userId, authPhase, loadDecisionInput]);

  useEffect(() => {
    if (!userId || authPhase !== 'AUTHENTICATED' || initialRouteUserId !== userId) return;

    const refreshIfCalendarDayChanged = () => {
      const isSafeAutoRouteScreen = currentScreenRef.current === 'home' || currentScreenRef.current === 'checkin';
      if (isSafeAutoRouteScreen && lastRoutedDate.current !== getLocalDateString()) {
        void loadDecisionInput();
      }
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') refreshIfCalendarDayChanged();
    };

    const intervalId = window.setInterval(refreshIfCalendarDayChanged, 60_000);
    window.addEventListener('focus', refreshIfCalendarDayChanged);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener('focus', refreshIfCalendarDayChanged);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [userId, authPhase, initialRouteUserId, loadDecisionInput]);

  if (authPhase !== 'AUTHENTICATED') {
    return <LoginScreen />;
  }

  // Do not mount Home until today's completion state has chosen the first authenticated
  // screen. Besides removing the visible Home→Check-in flash, this avoids generating or
  // displaying a recommendation from incomplete subjective input before the check-in UI.
  if (!userId || initialRouteUserId !== userId) {
    return (
      <div className="app-container">
        <main className="app-content">
          <div className="loading-state" role="status">Loading today&apos;s check-in status...</div>
        </main>
      </div>
    );
  }

  const handleNavigate = (newScreen: Screen) => {
    currentScreenRef.current = newScreen;
    setScreen(newScreen);
    setDesktopSettingsOpen(false);
    setMobileMoreOpen(false);

    // If the app spent midnight/background time inside a non-routable workflow, re-evaluate
    // the daily default as soon as the athlete next returns to Home or Check-in.
    if (
      (newScreen === 'home' || newScreen === 'checkin')
      && lastRoutedDate.current !== getLocalDateString()
    ) {
      void loadDecisionInput();
    }
  };

  const isWorkoutRunnerActive =
    (screen === 'sessions' || screen === 'testing') && activeStructuredSession?.state === 'in_progress';
  const dailyViewDate = decisionInput?.date ?? getLocalDateString();

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
              key={dailyViewDate}
              userId={userId!}
              onNavigate={handleNavigate}
              onViewData={() => {
                void loadDecisionInput();
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
              key={dailyViewDate}
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
              onNavigate={handleNavigate}
              onPlanChanged={() => {
                void loadDecisionInput();
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
