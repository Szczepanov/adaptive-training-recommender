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
import { StrengthSessionRunner } from './components/StrengthSessionRunner';
import { decisionComposer } from './engine/composer';
import type { DailyDecisionInput } from './engine/models';
import type { Screen } from './types/navigation';
import { useAuth } from './contexts/AuthContext';
import { LoginScreen } from './components/LoginScreen';
import { Header } from './components/Header';
import { MobileNav } from './components/MobileNav';
import { getLocalDateString } from './utils/localDate';

function App() {
  const { userId, authPhase } = useAuth();
  const [screen, setScreen] = useState<Screen>('home');
  const [decisionInput, setDecisionInput] = useState<DailyDecisionInput | null>(null);
  const [desktopSettingsOpen, setDesktopSettingsOpen] = useState(false);
  const [mobileMoreOpen, setMobileMoreOpen] = useState(false);

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
          <StrengthSessionRunner userId={userId!} />
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
