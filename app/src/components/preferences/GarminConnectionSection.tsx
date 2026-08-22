import { useState } from 'react';
import { signInWithCustomToken } from 'firebase/auth';
import { getAuthInstance } from '../../firebase';
import { garminAuthService } from '../../services/garminAuthService';
import { getErrorMessage } from '../../utils/errors';

export function GarminConnectionSection() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [mfaCode, setMfaCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const finish = async (customToken: string) => {
    // The backend only issues a token for the same Firebase UID when this form is used
    // from an authenticated session. Signing it in refreshes auth without changing owner.
    await signInWithCustomToken(getAuthInstance(), customToken);
    setSuccess(true);
    setChallengeId(null);
    setMfaCode('');
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setSuccess(false);
    try {
      if (challengeId) {
        const result = await garminAuthService.completeMfa(challengeId, mfaCode);
        if (result.status !== 'authenticated') throw new Error('Garmin MFA did not complete.');
        await finish(result.customToken);
        return;
      }

      const result = await garminAuthService.startLogin(email, password, true);
      setPassword('');
      if (result.status === 'mfa_required') {
        setChallengeId(result.challengeId);
        return;
      }
      await finish(result.customToken);
    } catch (err: unknown) {
      setError(getErrorMessage(err) || 'Failed to connect Garmin.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="preference-section">
      <h2>Garmin account</h2>
      <p className="preference-desc">
        Connect Garmin to this app account. Your password is used only for Garmin authentication;
        the app keeps the resulting refreshable session token, not the password.
      </p>
      <form onSubmit={submit}>
        {challengeId ? (
          <div className="form-group">
            <input
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="Garmin verification code"
              value={mfaCode}
              onChange={(event) => setMfaCode(event.target.value)}
              required
            />
          </div>
        ) : (
          <>
            <div className="form-group">
              <input
                type="email"
                autoComplete="username"
                placeholder="Garmin email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
              />
            </div>
            <div className="form-group">
              <input
                type="password"
                autoComplete="current-password"
                placeholder="Garmin password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
              />
            </div>
          </>
        )}
        {error && <p className="error-message">{error}</p>}
        {success && <p className="preference-success-note">Garmin is connected to this app account.</p>}
        <button type="submit" className="login-btn" disabled={loading}>
          {loading ? 'Connecting...' : challengeId ? 'Verify Garmin' : 'Connect Garmin'}
        </button>
        {challengeId && (
          <button
            type="button"
            className="auth-secondary-btn"
            onClick={() => {
              setChallengeId(null);
              setMfaCode('');
              setError(null);
            }}
          >
            Restart login
          </button>
        )}
      </form>
    </section>
  );
}
