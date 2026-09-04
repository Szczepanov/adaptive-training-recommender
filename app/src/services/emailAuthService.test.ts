import { beforeEach, describe, expect, it, vi } from 'vitest';

const firebaseAuth = vi.hoisted(() => ({
    createUserWithEmailAndPassword: vi.fn(),
    sendEmailVerification: vi.fn(),
    sendPasswordResetEmail: vi.fn(),
    signInWithEmailAndPassword: vi.fn(),
    signOut: vi.fn(),
    validatePassword: vi.fn(),
}));

vi.mock('firebase/auth', () => firebaseAuth);

import { emailAuthService, requiresEmailVerification } from './emailAuthService';

const auth = {} as Parameters<typeof emailAuthService.signIn>[0];
const passwordUser = (emailVerified: boolean) => ({
    emailVerified,
    providerData: [{ providerId: 'password' }],
});

describe('emailAuthService', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        firebaseAuth.sendEmailVerification.mockResolvedValue(undefined);
        firebaseAuth.signOut.mockResolvedValue(undefined);
        firebaseAuth.validatePassword.mockResolvedValue({ isValid: true });
    });

    it('requires verification only for unverified password identities', () => {
        expect(requiresEmailVerification(passwordUser(false) as never)).toBe(true);
        expect(requiresEmailVerification(passwordUser(true) as never)).toBe(false);
        expect(requiresEmailVerification({
            emailVerified: false,
            providerData: [{ providerId: 'custom' }],
        } as never)).toBe(false);
    });

    it('authenticates unverified password users without signing them out', async () => {
        firebaseAuth.signInWithEmailAndPassword.mockResolvedValue({ user: passwordUser(false) });

        await expect(emailAuthService.signIn(auth, 'athlete@example.com', 'secret')).resolves.toEqual({
            status: 'authenticated',
        });
        expect(firebaseAuth.signOut).not.toHaveBeenCalled();
    });

    it('allows verified password users and Garmin custom-token users', async () => {
        firebaseAuth.signInWithEmailAndPassword.mockResolvedValueOnce({ user: passwordUser(true) });
        await expect(emailAuthService.signIn(auth, 'athlete@example.com', 'secret')).resolves.toEqual({
            status: 'authenticated',
        });
        expect(firebaseAuth.signOut).not.toHaveBeenCalled();
    });

    it('validates project password policy before creating an account', async () => {
        firebaseAuth.validatePassword.mockResolvedValue({ isValid: false });

        await expect(emailAuthService.signUp(auth, 'athlete@example.com', 'weak')).rejects.toMatchObject({
            code: 'auth/password-does-not-meet-requirements',
        });
        expect(firebaseAuth.createUserWithEmailAndPassword).not.toHaveBeenCalled();
    });

    it('sends verification and keeps user signed in after account creation', async () => {
        const user = passwordUser(false);
        firebaseAuth.createUserWithEmailAndPassword.mockResolvedValue({ user });

        await emailAuthService.signUp(auth, 'athlete@example.com', 'strong-password');
        expect(firebaseAuth.sendEmailVerification).toHaveBeenCalledWith(user);
        expect(firebaseAuth.signOut).not.toHaveBeenCalled();
    });

    it('does not fail account creation if sending verification email fails', async () => {
        const user = passwordUser(false);
        firebaseAuth.createUserWithEmailAndPassword.mockResolvedValue({ user });
        firebaseAuth.sendEmailVerification.mockRejectedValue(new Error('Network error'));

        await expect(emailAuthService.signUp(auth, 'athlete@example.com', 'strong-password')).resolves.toBeUndefined();
        expect(firebaseAuth.signOut).not.toHaveBeenCalled();
    });

    it('keeps password reset responses generic for legacy user-not-found errors', async () => {
        firebaseAuth.sendPasswordResetEmail.mockRejectedValue({ code: 'auth/user-not-found' });
        await expect(emailAuthService.requestPasswordReset(auth, 'missing@example.com')).resolves.toBeUndefined();
    });
});
