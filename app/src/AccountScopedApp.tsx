import App from './App';
import { useAuth } from './contexts/AuthContext';

export function AccountScopedApp() {
  const { userId } = useAuth();

  // React preserves state for a component rendered at the same tree position. Make the
  // authenticated identity part of App's position so an account transition destroys the
  // previous account's entire UI/state subtree, including stale async callback targets.
  // Keep all unauthenticated auth phases on one key so auth bootstrap cannot reset login UI.
  const accountStateKey = userId ? `user:${userId}` : 'anonymous';
  return <App key={accountStateKey} />;
}
