import React, { useState } from 'react';
import { getAuthInstance } from '../firebase';
import { signInWithCustomToken, signInWithEmailAndPassword } from 'firebase/auth';
import { getDetailedErrorMessage, getErrorDetails, getErrorMessage } from '../utils/errors';
import { useAuth } from '../contexts/AuthContext';
import { garminAuthService } from '../services/garminAuthService';

export const LoginScreen: React.FC = () => {
  const { authPhase } = useAuth();
  const [mode, setMode] = useState<'garmin' | 'existing-app'>('garmin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [mfaCode, setMfaCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const finishGarminAuth = async (customToken: string) => {
    await signInWithCustomToken(getAuthInstance(), customToken);
  };

  const handleGarminLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setErrorMsg('');
    try {
      if (challengeId) {
        const submittedMfaCode = mfaCode;
        setMfaCode('');
        const result = await garminAuthService.completeMfa(challengeId, submittedMfaCode);
        if (result.status !== 'authenticated') {
          throw new Error('Garmin MFA did not complete authentication.');
        }
        setChallengeId(null);
        await finishGarminAuth(result.customToken);
        return;
      }

      // Copy credentials into the request and clear the password from React state before the
      // network round-trip completes. This also clears it on authentication/network failures,
      // rather than retaining a failed Garmin password in the rendered component state.
      const submittedPassword = password;
      setPassword('');
      const result = await garminAuthService.startLogin(email, submittedPassword);
      if (result.status === 'mfa_required') {
        setChallengeId(result.challengeId);
        return;
      }
      await finishGarminAuth(result.customToken);
    } catch (error: unknown) {
      console.error('Garmin authentication failed:', getErrorDetails(error));
      if (challengeId) {
        // PendingLoginStore consumes a Garmin challenge on every completion attempt, even
        // when the code is wrong. Never leave the UI pointing at a challenge the server
        // can no longer resume.
        setChallengeId(null);
        setMfaCode('');
      }
      setErrorMsg(getDetailedErrorMessage(error) || 'Failed to authenticate with Garmin.');
    } finally {
      setLoading(false);
    }
  };

  const handleExistingAppLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setErrorMsg('');
    try {
      await signInWithEmailAndPassword(getAuthInstance(), email, password);
    } catch (error: unknown) {
      console.error('Existing app login failed:', getErrorDetails(error));
      setErrorMsg(getErrorMessage(error) || 'Failed to log in.');
    } finally {
      setLoading(false);
    }
  };

  const switchMode = (nextMode: 'garmin' | 'existing-app') => {
    setMode(nextMode);
    setErrorMsg('');
    setPassword('');
    setChallengeId(null);
    setMfaCode('');
  };

  if (authPhase === 'CHECKING') {
    return (
      <div className="app-container auth-container">
        <div className="auth-card">
          <p>Checking authentication...</p>
        </div>
      </div>
    );
  }

  if (authPhase !== 'LOGIN') return null;

  if (mode === 'existing-app') {
    return (
      <div className="app-container auth-container">
        <div className="auth-card">
          <form onSubmit={handleExistingAppLogin}>
            <h1>Existing app login</h1>
            <p>Use this once to preserve an existing account, then connect Garmin in Preferences.</p>

            <div className="form-group">
              <input
                type="email"
                placeholder="App email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="username"
                required
              />
            </div>

            <div className="form-group">
              <input
                type="password"
                placeholder="App password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                required
              />
            </div>

            {errorMsg && <p className="error-message">{errorMsg}</p>}

            <button type="submit" className="login-btn" disabled={loading}>
              {loading ? 'Logging in...' : 'Log In'}
            </button>
            <button type="button" className="auth-secondary-btn" onClick={() => switchMode('garmin')}>
              Back to Garmin sign in
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="app-container auth-container">
      <div className="auth-card">
        <form onSubmit={handleGarminLogin}>
          <h1>{challengeId ? 'Verify Garmin login' : 'Continue with Garmin'}</h1>
          <p>
            {challengeId
              ? 'Enter the verification code requested by Garmin.'
              : 'Your Garmin account becomes your app sign-in. Your Garmin password is not stored.'}
          </p>

          {challengeId ? (
            <div className="form-group">
              <input
                type="text"
                inputMode="numeric"
                placeholder="Garmin verification code"
                value={mfaCode}
                onChange={(e) => setMfaCode(e.target.value)}
                autoComplete="one-time-code"
                required
              />
            </div>
          ) : (
            <>
              <div className="form-group">
                <input
                  type="email"
                  placeholder="Garmin email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="username"
                  required
                />
              </div>

              <div className="form-group">
                <input
                  type="password"
                  placeholder="Garmin password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                  required
                />
              </div>
            </>
          )}

          {errorMsg && <p className="error-message">{errorMsg}</p>}

          <button type="submit" className="login-btn" disabled={loading}>
            {loading ? 'Connecting...' : challengeId ? 'Verify' : 'Continue'}
          </button>
          {!challengeId && (
            <button
              type="button"
              className="auth-secondary-btn"
              onClick={() => switchMode('existing-app')}
            >
              Use existing app login
            </button>
          )}
          {challengeId && (
            <button
              type="button"
              className="auth-secondary-btn"
              onClick={() => {
                setChallengeId(null);
                setMfaCode('');
                setErrorMsg('');
              }}
            >
              Restart Garmin login
            </button>
          )}
        </form>
      </div>
    </div>
  );
};
