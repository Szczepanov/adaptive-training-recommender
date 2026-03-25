import React, { useState, useEffect } from 'react';
import './App.css';
import './index.css';
import { auth } from './firebase';
import { onAuthStateChanged } from 'firebase/auth';
import { Home } from './components/Home';
import { DailyCheckin } from './components/DailyCheckin';
import { Goals } from './components/Goals';
import { Constraints } from './components/Constraints';
import { Preferences } from './components/Preferences';
import { DataView } from './components/DataView';
import { constraintService } from './services/constraintService';
import { preferencesService } from './services/preferencesService';
import { decisionComposer } from './engine/composer';
import type { DailyDecisionInput } from './engine/models';

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

  // Initialize user data on first login
  const initializeUserData = async (userId: string) => {
    try {
      // Check if preferences exist, if not create defaults
      const prefs = await preferencesService.getPreferences(userId);
      if (!prefs) {
        await preferencesService.createDefaultPreferences(userId);
        console.log('Created default preferences for user');
      }
      
      // Initialize predefined constraints (they'll be created as inactive)
      await constraintService.initializePredefinedConstraints(userId);
      console.log('Initialized predefined constraints for user');
      
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
    } catch (e: any) {
      console.error(e);
      setErrorMsg(e.message || "Failed to log in.");
    } finally {
      setLoading(false);
    }
  };

  // const handleLogout = async () => {
  //   await signOut(auth);
  //   setScreen('home');
  // };

  const navigateTo = (newScreen: Screen) => {
    setScreen(newScreen);
  };

  const loadDecisionInput = async () => {
    if (!userId) return;
    try {
      const input = await decisionComposer.composeDailyDecisionInput(userId);
      setDecisionInput(input);
    } catch (error) {
      console.error('Error loading decision input:', error);
    }
  };

  // Load decision input when authenticated
  useEffect(() => {
    if (userId && authPhase === 'AUTHENTICATED') {
      loadDecisionInput();
    }
  }, [userId, authPhase]);

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

  // Main app with navigation
  return (
    <div className="app-container">
      <div className="app-content">
        {screen === 'home' && (
          <Home 
            userId={userId!} 
            onNavigate={navigateTo}
            onViewData={() => {
              loadDecisionInput();
              navigateTo('data');
            }}
          />
        )}
        
        {screen === 'data' && (
          <DataView 
            decisionInput={decisionInput}
            onBack={() => navigateTo('home')}
          />
        )}
        
        {screen === 'checkin' && (
          <DailyCheckin 
            userId={userId!} 
            onNavigate={navigateTo}
            onBack={() => navigateTo('home')}
          />
        )}
        
        {screen === 'goals' && (
          <Goals userId={userId!} onNavigate={navigateTo} />
        )}
        
        {screen === 'constraints' && (
          <Constraints userId={userId!} onNavigate={navigateTo} />
        )}
        
        {screen === 'preferences' && (
          <Preferences userId={userId!} onNavigate={navigateTo} />
        )}
      </div>
      
      {/* Bottom Navigation */}
      <nav className="bottom-nav">
        <button 
          className={`nav-item ${screen === 'home' ? 'active' : ''}`}
          onClick={() => navigateTo('home')}
        >
          <span className="nav-icon">🏠</span>
          <span className="nav-label">Home</span>
        </button>
        
        <button 
          className={`nav-item ${screen === 'checkin' ? 'active' : ''}`}
          onClick={() => navigateTo('checkin')}
        >
          <span className="nav-icon">✓</span>
          <span className="nav-label">Check-in</span>
        </button>
        
        <button 
          className={`nav-item ${screen === 'goals' ? 'active' : ''}`}
          onClick={() => navigateTo('goals')}
        >
          <span className="nav-icon">🎯</span>
          <span className="nav-label">Goals</span>
        </button>
        
        <button 
          className={`nav-item ${screen === 'constraints' ? 'active' : ''}`}
          onClick={() => navigateTo('constraints')}
        >
          <span className="nav-icon">⚠️</span>
          <span className="nav-label">Constraints</span>
        </button>
        
        <button 
          className={`nav-item ${screen === 'preferences' ? 'active' : ''}`}
          onClick={() => navigateTo('preferences')}
        >
          <span className="nav-icon">⚙️</span>
          <span className="nav-label">Preferences</span>
        </button>
      </nav>
    </div>
  );
}

export default App;
