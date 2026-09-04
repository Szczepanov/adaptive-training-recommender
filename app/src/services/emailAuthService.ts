import {
    createUserWithEmailAndPassword,
    sendEmailVerification,
    sendPasswordResetEmail,
    signInWithEmailAndPassword,
    validatePassword,
    type Auth,
    type User,
} from 'firebase/auth';

export type EmailSignInResult =
    | { status: 'authenticated' }
    | { status: 'verification_required' };

type VerificationUser = Pick<User, 'emailVerified' | 'providerData'>;

/** Garmin custom-token identities are not email/password accounts and remain unaffected. */
export function requiresEmailVerification(user: VerificationUser): boolean {
    return !user.emailVerified
        && user.providerData.some((provider) => provider.providerId === 'password');
}

function authCode(error: unknown): string | undefined {
    return (error as { code?: string })?.code;
}

export const emailAuthService = {
    async signIn(auth: Auth, email: string, password: string): Promise<EmailSignInResult> {
        await signInWithEmailAndPassword(auth, email, password);
        return { status: 'authenticated' };
    },

    async signUp(auth: Auth, email: string, password: string): Promise<void> {
        const policy = await validatePassword(auth, password);
        if (!policy.isValid) {
            throw Object.assign(
                new Error('Password does not meet the configured password policy.'),
                { code: 'auth/password-does-not-meet-requirements' },
            );
        }

        const credential = await createUserWithEmailAndPassword(auth, email, password);
        try {
            await sendEmailVerification(credential.user);
        } catch (error) {
            console.warn('Failed to send email verification:', error);
        }
    },

    async requestPasswordReset(auth: Auth, email: string): Promise<void> {
        try {
            await sendPasswordResetEmail(auth, email);
        } catch (error: unknown) {
            // Older projects without enumeration protection may still emit this code. Match
            // the protected behavior and keep the response indistinguishable.
            if (authCode(error) !== 'auth/user-not-found') throw error;
        }
    },
};
