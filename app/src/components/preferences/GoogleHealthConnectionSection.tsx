import { useEffect, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { getDb } from '../../firebase';
import { googleHealthLinkService } from '../../services/googleHealthLinkService';
import { getErrorMessage } from '../../utils/errors';

interface GoogleHealthConnection {
  status?: string;
  healthUserId?: string;
  linkedAt?: string;
}

interface GoogleHealthConnectionSectionProps {
  userId: string;
}

/** Reads the ?googleHealthLinked=success|error&reason=... query params left by the OAuth
 * callback redirect, then strips them from the URL so a page refresh doesn't re-show the
 * banner. Runs once per mount. */
function useCallbackBanner(): { success: boolean; reason: string | null } | null {
  const [banner, setBanner] = useState<{ success: boolean; reason: string | null } | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const linked = params.get('googleHealthLinked');
    if (!linked) return;

    setBanner({ success: linked === 'success', reason: params.get('reason') });

    params.delete('googleHealthLinked');
    params.delete('reason');
    const query = params.toString();
    const url = `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`;
    window.history.replaceState(null, '', url);
  }, []);

  return banner;
}

const REASON_MESSAGES: Record<string, string> = {
  google_declined: 'Google Health linking was cancelled.',
  missing_code_or_state: 'Google Health linking response was incomplete. Try again.',
  invalid_state: 'That link request expired or was already used. Try again.',
  token_exchange_failed: 'Google rejected the linking request. Try again.',
  unexpected_error: 'Something went wrong while linking Google Health.',
};

export function GoogleHealthConnectionSection({ userId }: GoogleHealthConnectionSectionProps) {
  const [connection, setConnection] = useState<GoogleHealthConnection | null>(null);
  const [loadingConnection, setLoadingConnection] = useState(true);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const callbackBanner = useCallbackBanner();

  useEffect(() => {
    const ref = doc(getDb(), 'users', userId, 'connections', 'googleHealth');
    return onSnapshot(
      ref,
      (snap) => {
        setConnection(snap.exists() ? (snap.data() as GoogleHealthConnection) : null);
        setLoadingConnection(false);
      },
      () => setLoadingConnection(false),
    );
  }, [userId]);

  const isConnected = connection?.status === 'active';

  const connect = async () => {
    setStarting(true);
    setError(null);
    try {
      await googleHealthLinkService.startLink();
      // startLink() navigates the browser away on success; nothing left to do here.
    } catch (err: unknown) {
      setError(getErrorMessage(err) || 'Failed to start Google Health linking.');
      setStarting(false);
    }
  };

  return (
    <section className="preference-section">
      <h2>Google Health</h2>
      <p className="preference-desc">
        Connect Google Health to pull Eight Sleep (and Health Connect-synced Garmin) recovery
        data. Google has not finished verifying this app for these data types yet, so you'll see
        an "unverified app" warning during linking, and you may be asked to reconnect roughly
        weekly until that's resolved.
      </p>

      {callbackBanner && (
        callbackBanner.success ? (
          <p className="preference-success-note">Google Health is connected to this app account.</p>
        ) : (
          <p className="error-message">
            {(callbackBanner.reason && REASON_MESSAGES[callbackBanner.reason])
              || 'Google Health linking failed.'}
          </p>
        )
      )}

      {error && <p className="error-message">{error}</p>}

      {!loadingConnection && isConnected && (
        <p className="preference-success-note">
          Connected{connection?.linkedAt ? ` since ${new Date(connection.linkedAt).toLocaleDateString()}` : ''}.
        </p>
      )}

      <button
        type="button"
        className="login-btn"
        onClick={connect}
        disabled={starting || loadingConnection}
      >
        {starting ? 'Redirecting to Google...' : isConnected ? 'Reconnect Google Health' : 'Connect Google Health'}
      </button>
    </section>
  );
}
