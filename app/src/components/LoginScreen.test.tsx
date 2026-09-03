import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { LoginScreen } from './LoginScreen';
import * as authContext from '../contexts/AuthContext';

vi.mock('../firebase', () => ({
  getAuthInstance: vi.fn(() => ({})),
}));

vi.mock('firebase/auth', () => ({
  signInWithCustomToken: vi.fn(),
}));

vi.mock('../services/emailAuthService', () => ({
  emailAuthService: {
    signIn: vi.fn(),
    signUp: vi.fn(),
    requestPasswordReset: vi.fn(),
  },
}));

vi.mock('../services/garminAuthService', () => ({
  garminAuthService: {
    startLogin: vi.fn(),
    completeMfa: vi.fn(),
  },
}));

describe('LoginScreen', () => {
  it('renders checking state when authPhase is CHECKING', () => {
    vi.spyOn(authContext, 'useAuth').mockReturnValue({
      userId: null,
      authPhase: 'CHECKING',
      user: null,
    });

    const html = renderToStaticMarkup(<LoginScreen />);
    expect(html).toContain('Checking authentication...');
  });

  it('renders sign-in form by default when authPhase is LOGIN', () => {
    vi.spyOn(authContext, 'useAuth').mockReturnValue({
      userId: null,
      authPhase: 'LOGIN',
      user: null,
    });

    const html = renderToStaticMarkup(<LoginScreen />);
    expect(html).toContain('Welcome back');
    expect(html).toContain('Sign in with your email and password');
    expect(html).toContain('Sign In');
    expect(html).toContain('Create Account');
    expect(html).toContain('Forgot password?');
    expect(html).toContain('Continue with Garmin');
  });

  it('returns null when authPhase is AUTHENTICATED', () => {
    vi.spyOn(authContext, 'useAuth').mockReturnValue({
      userId: 'test-user',
      authPhase: 'AUTHENTICATED',
      user: null,
    });

    const html = renderToStaticMarkup(<LoginScreen />);
    expect(html).toBe('');
  });
});
