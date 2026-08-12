import React, { useState } from 'react';
import { getAuthInstance } from '../firebase';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { getErrorMessage } from '../utils/errors';
import { useAuth } from '../contexts/AuthContext';

export const LoginScreen: React.FC = () => {
  const { authPhase } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setErrorMsg("");

    try {
      await signInWithEmailAndPassword(getAuthInstance(), email, password);
    } catch (e: unknown) {
      console.error(e);
      setErrorMsg(getErrorMessage(e) || "Failed to log in.");
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

  return null;
};
