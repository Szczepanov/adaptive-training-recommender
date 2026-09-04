import { beforeEach, describe, expect, it, vi } from 'vitest';

const firebaseAuth = vi.hoisted(() => ({
    createUserWithEmailAndPassword: vi.fn(),
    sendEmailVerification: vi.fn(),
    sendPasswordResetEmail: vi.fn(),
    signInWithEmailAndPassword: vi.fn(),
    validatePassword: vi.fn(),
}));

vi.mock('firebase/auth', () => firebaseAuth);

import { emailAuthService } from './emailAuthService';

const auth = {} as Parameters<typeof emailAuthService.signIn>[0];
const passwordUser = (emailVerified: boolean) => ({
    emailVerified,
    providerData: [{ providerId: 'password' }],
});

describe('emailAuthService', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        firebaseAuth.sendEmailVerification.mockResolvedValue(undefined);
        firebaseAuth.validatePassword.mockResolvedValue({ isValid: true });
    });

    it('authenticates unverified password users', async () => {
        firebaseAuth.signInWithEmailAndPassword.mockResolvedValue({ user: passwordUser(false) });

        await expect(emailAuthService.signIn(auth, 'athlete@example.com', 'secret')).resolves.toEqual({
            status: 'authenticated',
        });
    });

    it('authenticates verified password users', async () => {
        firebaseAuth.signInWithEmailAndPassword.mockResolvedValue({ user: passwordUser(true) });

        await expect(emailAuthService.signIn(auth, 'athlete@example.com', 'secret')).resolves.toEqual({
            status: 'authenticated',
        });
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
    });

    it('does not block account creation on verification email delivery', async () => {
        const user = passwordUser(false);
        let resolveVerification: (() => void) | undefined;
        firebaseAuth.createUserWithEmailAndPassword.mockResolvedValue({ user });
        firebaseAuth.sendEmailVerification.mockImplementationOnce(() => new Promise<void>((resolve) => {
            resolveVerification = resolve;
        }));

        await expect(emailAuthService.signUp(auth, 'athlete@example.com', 'strong-password')).resolves.toBeUndefined();
        expect(firebaseAuth.sendEmailVerification).toHaveBeenCalledWith(user);

        resolveVerification?.();
    });

    it('does not fail account creation if sending verification email fails', async () => {
        const user = passwordUser(false);
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        firebaseAuth.createUserWithEmailAndPassword.mockResolvedValue({ user });
        firebaseAuth.sendEmailVerification.mockRejectedValue(new Error('Network error'));

        try {
            await expect(emailAuthService.signUp(auth, 'athlete@example.com', 'strong-password')).resolves.toBeUndefined();
            await Promise.resolve();
            expect(warn).toHaveBeenCalledWith('Failed to send email verification:', expect.any(Error));
        } finally {
            warn.mockRestore();
        }
    });

    it('keeps password reset responses generic for legacy user-not-found errors', async () => {
        firebaseAuth.sendPasswordResetEmail.mockRejectedValue({ code: 'auth/user-not-found' });
        await expect(emailAuthService.requestPasswordReset(auth, 'missing@example.com')).resolves.toBeUndefined();
    });
});
