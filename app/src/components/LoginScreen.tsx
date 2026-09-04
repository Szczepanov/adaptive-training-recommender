import React, { useState } from 'react';
import { getAuthInstance } from '../firebase';
import {
  signInWithCustomToken,
} from 'firebase/auth';
import { getDetailedErrorMessage, getErrorDetails, getErrorMessage } from '../utils/errors';
import { useAuth } from '../contexts/AuthContext';
import { garminAuthService } from '../services/garminAuthService';
import { emailAuthService } from '../services/emailAuthService';

export type AuthMode = 'sign-in' | 'sign-up' | 'forgot-password' | 'garmin';

function mapFirebaseAuthError(error: unknown): string {
  const errCode = (error as { code?: string })?.code;
  switch (errCode) {
    case 'auth/email-already-in-use':
      // Deliberately non-account-specific: naming "already registered" here would let an
      // attacker enumerate valid emails by probing sign-up. Same generic wording a real
      // sign-up failure would get.
      return 'Unable to create this account. Please try again.';
    case 'auth/invalid-email':
      return 'Please enter a valid email address.';
    case 'auth/weak-password':
    case 'auth/password-does-not-meet-requirements':
      return 'Password does not meet this project\'s password policy.';
    case 'auth/user-not-found':
    case 'auth/wrong-password':
    case 'auth/invalid-credential':
      return 'Invalid email or password. Please try again.';
    case 'auth/user-disabled':
      return 'This account has been disabled. Please contact support.';
    case 'auth/too-many-requests':
      return 'Too many failed attempts. Please wait a moment or reset your password.';
    case 'auth/network-request-failed':
      return 'Network connection error. Please check your connection and try again.';
    default:
      return getDetailedErrorMessage(error) || getErrorMessage(error) || 'An error occurred during authentication.';
  }
}

export const LoginScreen: React.FC = () => {
  const { authPhase } = useAuth();
  const [mode, setMode] = useState<AuthMode>('sign-in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [mfaCode, setMfaCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [infoMsg, setInfoMsg] = useState('');

  const finishGarminAuth = async (customToken: string) => {
    await signInWithCustomToken(getAuthInstance(), customToken);
  };

  const switchMode = (nextMode: AuthMode) => {
    setMode(nextMode);
    setErrorMsg('');
    setInfoMsg('');
    setPassword('');
    setConfirmPassword('');
    setChallengeId(null);
    setMfaCode('');
  };

  const isValidEmail = (val: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val.trim());

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    setInfoMsg('');

    const trimmedEmail = email.trim();
    if (!isValidEmail(trimmedEmail)) {
      setErrorMsg('Please enter a valid email address.');
      return;
    }
    if (!password) {
      setErrorMsg('Please enter your password.');
      return;
    }

    setLoading(true);
    try {
      await emailAuthService.signIn(getAuthInstance(), trimmedEmail, password);
      setPassword('');
    } catch (error: unknown) {
      console.error('Sign-in failed:', getErrorDetails(error));
      setErrorMsg(mapFirebaseAuthError(error));
    } finally {
      setLoading(false);
    }
  };

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    setInfoMsg('');

    const trimmedEmail = email.trim();
    if (!isValidEmail(trimmedEmail)) {
      setErrorMsg('Please enter a valid email address.');
      return;
    }
    if (!password) {
      setErrorMsg('Please enter a password.');
      return;
    }
    if (password !== confirmPassword) {
      setErrorMsg('Passwords do not match.');
      return;
    }

    setLoading(true);
    try {
      await emailAuthService.signUp(getAuthInstance(), trimmedEmail, password);
      setPassword('');
      setConfirmPassword('');
    } catch (error: unknown) {
      console.error('Account creation failed:', getErrorDetails(error));
      setErrorMsg(mapFirebaseAuthError(error));
    } finally {
      setLoading(false);
    }
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    setInfoMsg('');

    const trimmedEmail = email.trim();
    if (!isValidEmail(trimmedEmail)) {
      setErrorMsg('Please enter a valid email address.');
      return;
    }

    setLoading(true);
    try {
      await emailAuthService.requestPasswordReset(getAuthInstance(), trimmedEmail);
      setInfoMsg('If an account exists for that email, a password reset link has been sent.');
    } catch (error: unknown) {
      console.error('Password reset failed:', getErrorDetails(error));
      setErrorMsg(mapFirebaseAuthError(error));
    } finally {
      setLoading(false);
    }
  };

  const handleGarminLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setErrorMsg('');
    setInfoMsg('');
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

      const submittedPassword = password;
      setPassword('');
      const result = await garminAuthService.startLogin(email.trim(), submittedPassword);
      if (result.status === 'mfa_required') {
        setChallengeId(result.challengeId);
        return;
      }
      await finishGarminAuth(result.customToken);
    } catch (error: unknown) {
      console.error('Garmin authentication failed:', getErrorDetails(error));
      if (challengeId) {
        setChallengeId(null);
        setMfaCode('');
      }
      setErrorMsg(getDetailedErrorMessage(error) || 'Failed to authenticate with Garmin.');
    } finally {
      setLoading(false);
    }
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

  // Mode: Reset Password
  if (mode === 'forgot-password') {
    return (
      <div className="app-container auth-container">
        <div className="auth-card">
          <form onSubmit={handleForgotPassword}>
            <h1>Reset password</h1>
            <p>Enter your email and we&apos;ll send you a password reset link.</p>

            <div className="form-group">
              <input
                type="email"
                placeholder="Email address"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                required
              />
            </div>

            {errorMsg && <p className="error-message">{errorMsg}</p>}
            {infoMsg && <p className="info-message">{infoMsg}</p>}

            <button type="submit" className="login-btn" disabled={loading}>
              {loading ? 'Sending link...' : 'Send Reset Link'}
            </button>
            <button
              type="button"
              className="auth-secondary-btn"
              onClick={() => switchMode('sign-in')}
            >
              Back to Sign In
            </button>
          </form>
        </div>
      </div>
    );
  }

  // Mode: Continue with Garmin
  if (mode === 'garmin') {
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

            {!challengeId ? (
              <button
                type="button"
                className="auth-secondary-btn"
                onClick={() => switchMode('sign-in')}
              >
                Back to Email Sign In
              </button>
            ) : (
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
  }

  // Modes: 'sign-in' or 'sign-up'
  return (
    <div className="app-container auth-container">
      <div className="auth-card">
        <div className="auth-tabs" role="tablist" aria-label="Authentication mode">
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'sign-in'}
            className={`auth-tab ${mode === 'sign-in' ? 'active' : ''}`}
            onClick={() => switchMode('sign-in')}
          >
            Sign In
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'sign-up'}
            className={`auth-tab ${mode === 'sign-up' ? 'active' : ''}`}
            onClick={() => switchMode('sign-up')}
          >
            Create Account
          </button>
        </div>

        <form onSubmit={mode === 'sign-in' ? handleSignIn : handleSignUp}>
          <h1>{mode === 'sign-in' ? 'Welcome back' : 'Create account'}</h1>
          <p>
            {mode === 'sign-in'
              ? 'Sign in with your email and password.'
              : 'Sign up to start your adaptive training journey.'}
          </p>

          <div className="form-group">
            <input
              type="email"
              placeholder="Email address"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="username"
              required
            />
          </div>

          <div className="form-group">
            <input
              type="password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === 'sign-in' ? 'current-password' : 'new-password'}
              required
            />
          </div>

          {mode === 'sign-up' && (
            <div className="form-group">
              <input
                type="password"
                placeholder="Confirm password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                autoComplete="new-password"
                required
              />
            </div>
          )}

          {mode === 'sign-in' && (
            <div style={{ textAlign: 'right', marginTop: '-0.5rem' }}>
              <button
                type="button"
                className="auth-link-btn"
                onClick={() => switchMode('forgot-password')}
              >
                Forgot password?
              </button>
            </div>
          )}

          {errorMsg && <p className="error-message">{errorMsg}</p>}
          {infoMsg && <p className="info-message">{infoMsg}</p>}

          <button type="submit" className="login-btn" disabled={loading}>
            {loading
              ? mode === 'sign-in'
                ? 'Signing in...'
                : 'Creating account...'
              : mode === 'sign-in'
              ? 'Sign In'
              : 'Create Account'}
          </button>

          <div className="auth-divider">
            <span>or</span>
          </div>

          <button
            type="button"
            className="auth-secondary-btn"
            onClick={() => switchMode('garmin')}
          >
            Continue with Garmin
          </button>
        </form>
      </div>
    </div>
  );
};
