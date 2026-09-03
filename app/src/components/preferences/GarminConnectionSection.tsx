import { useEffect, useState } from 'react';
import { signInWithCustomToken } from 'firebase/auth';
import { getAuthInstance } from '../../firebase';
import { garminAuthService } from '../../services/garminAuthService';
import { garminConnectionService } from '../../services/garminConnectionService';
import { getErrorMessage } from '../../utils/errors';
import { firestoreDateToDate, type FirestoreDateValue } from '../../utils/firestoreDate';
import { getLocalDateString } from '../../utils/localDate';

interface GarminConnection {
  status?: string;
  linkedAt?: FirestoreDateValue;
}

interface GarminConnectionSectionProps {
  userId: string;
}

export function GarminConnectionSection({ userId }: GarminConnectionSectionProps) {
  const [connection, setConnection] = useState<GarminConnection | null>(null);
  const [loadingConnection, setLoadingConnection] = useState(true);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [mfaCode, setMfaCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    setLoadingConnection(true);
    setConnectionError(null);
    return garminConnectionService.subscribeToGarminConnection(userId, (result) => {
      setLoadingConnection(false);
      if (result.state === 'connected') {
        setConnection({ status: 'active', linkedAt: result.linkedAt as FirestoreDateValue });
        setConnectionError(null);
      } else if (result.state === 'disconnected') {
        setConnection(null);
        setConnectionError(null);
      } else {
        setConnection(null);
        setConnectionError(getErrorMessage(result.error) || 'Could not verify Garmin connection status.');
      }
    });
  }, [userId]);

  const isConnected = connection?.status === 'active';
  const linkedAtDate = firestoreDateToDate(connection?.linkedAt);
  const linkedAtLabel = linkedAtDate ? getLocalDateString(linkedAtDate) : null;

  const finish = async (customToken: string) => {
    // The backend only issues a token for the same Firebase UID when this form is used
    // from an authenticated session. Signing it in refreshes auth without changing owner.
    await signInWithCustomToken(getAuthInstance(), customToken);
    // commit_link() has already committed canonical + mirror status before issuing the token.
    // Mark this render connected immediately rather than flashing the login form while the
    // Firestore listener catches up.
    setConnection({ status: 'active' });
    setConnectionError(null);
    setSuccess(true);
    setChallengeId(null);
    setMfaCode('');
    setShowForm(false);
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setSuccess(false);
    try {
      if (challengeId) {
        const submittedMfaCode = mfaCode;
        setMfaCode('');
        const result = await garminAuthService.completeMfa(challengeId, submittedMfaCode);
        if (result.status !== 'authenticated') throw new Error('Garmin MFA did not complete.');
        await finish(result.customToken);
        return;
      }

      // Do not retain Garmin credentials in rendered component state while the request is in
      // flight or after an authentication/network failure. The server follows the same rule.
      const submittedPassword = password;
      setPassword('');
      const result = await garminAuthService.startLogin(email, submittedPassword, true);
      if (result.status === 'mfa_required') {
        setChallengeId(result.challengeId);
        return;
      }
      await finish(result.customToken);
    } catch (err: unknown) {
      if (challengeId) {
        // MFA challenges are single-use on the server. A failed verification must return
        // to the credential step instead of offering a retry against a consumed challenge.
        setChallengeId(null);
        setMfaCode('');
      }
      setError(getErrorMessage(err) || 'Failed to connect Garmin.');
    } finally {
      setLoading(false);
    }
  };

  // An unknown status is intentionally not rendered as "disconnected". Presenting the
  // credential form after a verification failure would recreate the original false-status UX.
  const formVisible = !loadingConnection && !connectionError && (!isConnected || showForm);

  return (
    <section className="preference-section">
      <h2>Garmin account</h2>
      <p className="preference-desc">
        Connect Garmin to this app account. Your password is used only for Garmin authentication;
        the app keeps the resulting refreshable session token, not the password.
      </p>

      {loadingConnection && <p className="preference-desc">Checking Garmin connection…</p>}
      {!loadingConnection && connectionError && (
        <p className="error-message">{connectionError} Refresh the page before reconnecting.</p>
      )}

      {!loadingConnection && isConnected && (
        <p className="preference-success-note">
          Connected{linkedAtLabel ? ` since ${linkedAtLabel}` : ''}.
        </p>
      )}

      {!loadingConnection && isConnected && !showForm && (
        <button type="button" className="auth-secondary-btn" onClick={() => setShowForm(true)}>
          Reconnect Garmin
        </button>
      )}

      {formVisible && (
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
          {isConnected && !challengeId && (
            <button
              type="button"
              className="auth-secondary-btn"
              onClick={() => {
                setShowForm(false);
                setError(null);
              }}
            >
              Cancel
            </button>
          )}
        </form>
      )}
    </section>
  );
}
