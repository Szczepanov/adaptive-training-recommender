import React, { useState, useEffect, useCallback, useRef } from 'react';
import './App.css';
import './index.css';
import { auth } from './firebase';
import { onAuthStateChanged } from 'firebase/auth';
import { Home } from './components/Home';
import { DailyCheckin } from './components/DailyCheckin';
import { Goals } from './components/Goals';
import { TrainingSettings } from './components/TrainingSettings';
import { Preferences } from './components/Preferences';
import { DataView } from './components/DataView';
import { trainingSettingsService } from './services/trainingSettingsService';
import { preferencesService } from './services/preferencesService';
import { decisionComposer } from './engine/composer';
import type { DailyDecisionInput } from './engine/models';
import { getErrorMessage } from './utils/errors';

type Screen = 'home' | 'checkin' | 'goals' | 'constraints' | 'preferences' | 'data';

function App() {
  const [screen, setScreen] = useState<Screen>('home');
  const [userId, setUserId] = useState<string | null>(null);
  const [authPhase, setAuthPhase] = useState<'CHECKING' | 'LOGIN' | 'AUTHENTICATED'>('CHECKING');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [decisionInput, setDecisionInput] = useState<DailyDecisionInput | null>(null);
  const [desktopSettingsOpen, setDesktopSettingsOpen] = useState(false);
  const [mobileMoreOpen, setMobileMoreOpen] = useState(false);
  const desktopSettingsRef = useRef<HTMLDivElement>(null);

  // Initialize user data on first login
  const initializeUserData = async (userId: string) => {
    try {
      // Check if preferences exist, if not create defaults
      const prefs = await preferencesService.getPreferences(userId);
      if (!prefs) {
        await preferencesService.createDefaultPreferences(userId);
        console.log('Created default preferences for user');
      }
      
      // Creates the typed profile for new users or safely migrates legacy constraints.
      await trainingSettingsService.getTrainingSettings(userId);
      
    } catch (error) {
      console.error('Error initializing user data:', error);
    }
  };

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (user) {
        setUserId(user.uid);
        setAuthPhase('AUTHENTICATED');
        // Initialize user data in the background
        initializeUserData(user.uid);
      } else {
        setUserId(null);
        setAuthPhase('LOGIN');
      }
    });
    return () => unsubscribe();
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setErrorMsg("");
    
    try {
      // Import signInWithEmailAndPassword only when needed
      const { signInWithEmailAndPassword } = await import('firebase/auth');
      await signInWithEmailAndPassword(auth, email, password);
    } catch (e: unknown) {
      console.error(e);
      setErrorMsg(getErrorMessage(e) || "Failed to log in.");
    } finally {
      setLoading(false);
    }
  };

  // const handleLogout = async () => {
  //   await signOut(auth);
  //   setScreen('home');
  // };


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
      loadDecisionInput();
    }
  }, [userId, authPhase, loadDecisionInput]);

  const mobileMoreBtnRef = useRef<HTMLButtonElement>(null);
  const mobileDrawerRef = useRef<HTMLDivElement>(null);

  // Lock body scroll and trap focus when mobileMoreOpen is active
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
    const handlePointerDown = (event: MouseEvent) => {
      if (!desktopSettingsRef.current?.contains(event.target as Node)) {
        setDesktopSettingsOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (desktopSettingsOpen) setDesktopSettingsOpen(false);
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

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [desktopSettingsOpen, mobileMoreOpen]);

  // Auth screen
  if (authPhase === 'CHECKING') {
    return (
      <div className="app-container auth-container">
        <div className="auth-card">
          <p>Checking authentication...</p>
        </div>
      </div>
    );
  }

  if (authPhase === 'LOGIN') {
    return (
      <div className="app-container auth-container">
        <div className="auth-card">
          <form onSubmit={handleLogin}>
            <h1>Secure Login</h1>
            <p>Access is restricted to authorized users.</p>
            
            <div className="form-group">
              <input 
                type="email" 
                placeholder="Email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required 
              />
            </div>
            
            <div className="form-group">
              <input 
                type="password" 
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required 
              />
            </div>
            
            {errorMsg && <p className="error-message">{errorMsg}</p>}
            
            <button type="submit" className="login-btn" disabled={loading}>
              {loading ? 'Logging in...' : 'Log In'}
            </button>
          </form>
        </div>
      </div>
    );
  }



  const handleLogout = async () => {
    const { signOut } = await import('firebase/auth');
    await signOut(auth);
  };

  const handleNavigate = (newScreen: Screen) => {
    setScreen(newScreen);
    setDesktopSettingsOpen(false);
    setMobileMoreOpen(false);
  };

  // Main app with navigation
  return (
    <div className="app-container">
      {/* Global Top Navbar */}
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
      </main>

      {/* Mobile Bottom Navigation */}
      <nav className="bottom-nav">
        <button 
          className={`nav-item ${screen === 'home' ? 'active' : ''}`}
          onClick={() => handleNavigate('home')}
        >
          <span className="nav-icon">🏠</span>
          <span className="nav-label">Home</span>
        </button>
        
        <button 
          className={`nav-item ${screen === 'checkin' ? 'active' : ''}`}
          onClick={() => handleNavigate('checkin')}
        >
          <span className="nav-icon">✓</span>
          <span className="nav-label">Check-in</span>
        </button>
        
        <button 
          className={`nav-item ${screen === 'goals' ? 'active' : ''}`}
          onClick={() => handleNavigate('goals')}
        >
          <span className="nav-icon">🎯</span>
          <span className="nav-label">Goals</span>
        </button>
        
        <button 
          ref={mobileMoreBtnRef}
          className={`nav-item ${['constraints', 'preferences', 'data'].includes(screen) ? 'active' : ''}`}
          onClick={() => setMobileMoreOpen((isOpen) => !isOpen)}
          aria-expanded={mobileMoreOpen}
          aria-haspopup="dialog"
        >
          <span className="nav-icon">⋯</span>
          <span className="nav-label">More</span>
        </button>
      </nav>

      {/* Mobile Overlay More Menu Drawer */}
      {mobileMoreOpen && (
        <div className="mobile-more-overlay" onClick={() => setMobileMoreOpen(false)}>
          <div ref={mobileDrawerRef} className="mobile-more-drawer" role="dialog" aria-modal="true" aria-labelledby="mobile-more-title" onClick={(e) => e.stopPropagation()}>
            <div className="drawer-header">
              <h3 id="mobile-more-title">Navigation & Settings</h3>
              <button className="close-drawer-btn" onClick={() => setMobileMoreOpen(false)} aria-label="Close navigation and settings">✕</button>
            </div>
            <div className="drawer-items">
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
    </div>
  );
}

export default App;
